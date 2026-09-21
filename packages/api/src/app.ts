import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  adminHideInputSchema,
  changedFields,
  generateId,
  generateUniqueId,
  groupPhotoInputSchema,
  GROUP_LIMITS,
  isValidId,
  mergeInputSchema,
  normalizeAnswer,
  personInputSchema,
  personPhotoInputSchema,
  PERSON_LIMITS,
  uploadUrlInputSchema,
} from '@vsp/shared';
import type { GroupPhoto, Person, PersonPhoto, Revision, RevisionKind } from '@vsp/shared';
import type { Store } from './store/types.js';
import type { Blobs } from './blobs/types.js';
import type { SecretsProvider } from './config.js';

export interface AppDeps {
  store: Store;
  blobs: Blobs;
  secrets: SecretsProvider;
  /** 每個 IP 每分鐘允許的寫入次數 */
  writeRateLimit?: number;
}

type Env = { Variables: { ip: string } };

const WRITE_TOKEN_HEADER = 'x-write-token';
const ADMIN_KEY_HEADER = 'x-admin-key';

/* ---------- 小工具 ---------- */

function fail(status: ContentfulStatusCode, error: string, message: string, extra?: Record<string, unknown>): never {
  throw new HTTPException(status, { res: Response.json({ error, message, ...extra }, { status }) });
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function now() {
  return new Date().toISOString();
}

function makeRevision(
  target: Revision['target'],
  targetId: string,
  kind: RevisionKind,
  before: Person | GroupPhoto | null,
  snapshot: { nameZh: string; year: number },
  by: string,
  changed: string[] = [],
): Revision {
  const ts = now();
  return {
    revId: `${ts}#${generateId().slice(0, 4)}`,
    target,
    targetId,
    ts,
    kind,
    before,
    changedFields: changed,
    nameZh: snapshot.nameZh,
    year: snapshot.year,
    by,
  };
}

/** 從 CloudFront / API Gateway / 本機取得使用者 IP，供 rate limit 用。 */
function clientIp(c: Context<Env>): string {
  const cf = c.req.header('cloudfront-viewer-address');
  if (cf) return cf.replace(/:\d+$/, '');
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const env = c.env as { requestContext?: { http?: { sourceIp?: string } } } | undefined;
  return env?.requestContext?.http?.sourceIp ?? 'local';
}

const PERSON_KEY = /^persons\/([A-Za-z0-9]{6})\/([A-Za-z0-9]{6})(_t)?\.(jpg|webp)$/;
const GROUP_KEY = /^groups\/(\d{4})\/([A-Za-z0-9]{6})(_t)?\.(jpg|webp)$/;

/* ---------- App ---------- */

export function createApp(deps: AppDeps) {
  const { store, blobs, secrets } = deps;
  const writeLimit = deps.writeRateLimit ?? 30;
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.set('ip', clientIp(c));
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: 'internal', message: '伺服器錯誤，請稍後再試' }, 500);
  });

  /** 寫入端點共用：驗暗號 → rate limit。順序固定，機器人不會拿到 token，不會消耗配額。 */
  const requireToken: MiddlewareHandler<Env> = async (c, next) => {
    const s = await secrets();
    const expected = await hmacHex(s.tokenSecret, normalizeAnswer(s.passphraseAnswer));
    const got = c.req.header(WRITE_TOKEN_HEADER);
    if (!got || got !== expected) fail(401, 'token_required', '第一次寫入需要回答一題暗號', { question: s.passphraseQuestion });
    if (await store.rateLimitHit(c.get('ip'), writeLimit, 60)) fail(429, 'rate_limited', '寫入太頻繁，請一分鐘後再試');
    await next();
  };

  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    const s = await secrets();
    if (c.req.header(ADMIN_KEY_HEADER) !== s.adminKey) fail(403, 'forbidden', '管理密鑰錯誤');
    await next();
  };

  async function parse<T>(c: Context<Env>, schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { message: string; path: (string | number)[] }[] } } }): Promise<T> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      fail(400, 'bad_json', '請求格式錯誤');
    }
    const r = schema.safeParse(body);
    if (!r.success) {
      const issue = r.error!.issues[0];
      fail(400, 'invalid', `${issue?.path.join('.') ?? ''} ${issue?.message ?? '欄位有誤'}`.trim(), { issues: r.error!.issues });
    }
    return r.data as T;
  }

  async function loadPerson(id: string, opts?: { allowHidden?: boolean }): Promise<Person> {
    if (!isValidId(id)) fail(404, 'not_found', '找不到這個人');
    const p = await store.getPerson(id);
    if (!p || (!opts?.allowHidden && p.status !== 'active')) fail(404, 'not_found', '找不到這個人');
    return p;
  }

  /* ---------- 暗號 ---------- */

  app.get('/api/verify/question', async (c) => {
    const s = await secrets();
    return c.json({ question: s.passphraseQuestion });
  });

  app.post('/api/verify', async (c) => {
    if (await store.rateLimitHit(`verify#${c.get('ip')}`, 15, 60)) fail(429, 'rate_limited', '嘗試太多次，請一分鐘後再試');
    const body = (await c.req.json().catch(() => ({}))) as { answer?: unknown };
    const s = await secrets();
    const ok = normalizeAnswer(String(body.answer ?? '')) === normalizeAnswer(s.passphraseAnswer);
    if (!ok) fail(400, 'wrong_answer', '答案不對，再想想？', { question: s.passphraseQuestion });
    return c.json({ token: await hmacHex(s.tokenSecret, normalizeAnswer(s.passphraseAnswer)) });
  });

  /* ---------- Person ---------- */

  app.get('/api/persons', async (c) => {
    const persons = await store.listPersons();
    return c.json({ persons });
  });

  app.get('/api/persons/:id', async (c) => {
    const p = await loadPerson(c.req.param('id'), { allowHidden: true });
    const revisions = await store.listRevisions('person', p.personId);
    return c.json({ person: p, revisions });
  });

  app.post('/api/persons', requireToken, async (c) => {
    const input = await parse(c, personInputSchema);
    const ts = now();
    const person: Person = {
      personId: await generateUniqueId((id) => store.idExists(id)),
      ...input,
      yearJoined: input.yearJoined as number,
      photos: [],
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    };
    await store.putPerson(person);
    await store.putRevision(
      makeRevision('person', person.personId, 'create', null, { nameZh: person.nameZh, year: person.yearJoined }, input.updatedBy),
    );
    return c.json({ person }, 201);
  });

  app.put('/api/persons/:id', requireToken, async (c) => {
    const before = await loadPerson(c.req.param('id'));
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) fail(400, 'bad_json', '請求格式錯誤');
    const r = personInputSchema.safeParse(raw);
    if (!r.success) fail(400, 'invalid', r.error.issues[0]?.message ?? '欄位有誤', { issues: r.error.issues });
    const input = r.data;
    // 還原：前端把某筆 revision 的 before 送回來，附 restoreOf；照片一併還原（S3 物件從未刪除）
    const isRestore = typeof raw.restoreOf === 'string';
    const restoredPhotos = isRestore && Array.isArray(raw.photos) ? (raw.photos as PersonPhoto[]).slice(0, PERSON_LIMITS.photos) : null;
    const after: Person = {
      ...before,
      ...input,
      yearJoined: input.yearJoined as number,
      photos: restoredPhotos ?? before.photos,
      updatedAt: now(),
    };
    const changed = changedFields(before, after);
    if (changed.length === 0) return c.json({ person: before, unchanged: true });
    await store.putPerson(after);
    await store.putRevision(
      makeRevision('person', after.personId, isRestore ? 'restore' : 'update', before, { nameZh: after.nameZh, year: after.yearJoined }, input.updatedBy, changed),
    );
    return c.json({ person: after });
  });

  /** 合併兩筆重複資料：保留 keepId，逐欄由前端選好送來；dropId 標 hidden 並指向 keepId。 */
  app.post('/api/persons/merge', requireToken, async (c) => {
    const input = await parse(c, mergeInputSchema);
    if (input.keepId === input.dropId) fail(400, 'invalid', '兩筆不能是同一人');
    const keep = await loadPerson(input.keepId);
    const drop = await loadPerson(input.dropId);
    const pool = new Map([...keep.photos, ...drop.photos].map((p) => [p.s3Key, p]));
    const photos: PersonPhoto[] = [];
    for (const ph of input.photos) {
      const found = pool.get(ph.s3Key);
      if (!found) fail(400, 'invalid', '照片不屬於這兩筆資料');
      photos.push({ ...found, caption: ph.caption });
    }
    const ts = now();
    const merged: Person = {
      ...keep,
      ...input.merged,
      yearJoined: input.merged.yearJoined as number,
      photos,
      updatedAt: ts,
    };
    await store.putPerson(merged);
    await store.putRevision(
      makeRevision('person', keep.personId, 'merge', keep, { nameZh: merged.nameZh, year: merged.yearJoined }, input.merged.updatedBy, changedFields(keep, merged)),
    );
    const dropped: Person = { ...drop, status: 'hidden', mergedInto: keep.personId, updatedAt: ts, updatedBy: input.merged.updatedBy };
    await store.putPerson(dropped);
    await store.putRevision(
      makeRevision('person', drop.personId, 'merged_away', drop, { nameZh: drop.nameZh, year: drop.yearJoined }, input.merged.updatedBy, ['status']),
    );
    return c.json({ person: merged });
  });

  /* ---------- 個人照（在人物面板內即時上傳，不經過編輯表單） ---------- */

  app.post('/api/persons/:id/photos', requireToken, async (c) => {
    const before = await loadPerson(c.req.param('id'));
    const input = await parse(c, personPhotoInputSchema);
    if (before.photos.length >= PERSON_LIMITS.photos)
      fail(409, 'limit_reached', `每人最多 ${PERSON_LIMITS.photos} 張照片，請先刪一張`);
    const m = PERSON_KEY.exec(input.s3Key);
    const mt = PERSON_KEY.exec(input.thumbKey);
    if (!m || !mt || m[1] !== before.personId || mt[1] !== before.personId || m[2] !== mt[2] || m[3] || !mt[3])
      fail(400, 'invalid', '照片路徑不正確');
    if (!(await blobs.exists(input.s3Key))) fail(400, 'not_uploaded', '照片尚未上傳完成');
    const photo: PersonPhoto = { ...input, uploadedAt: now() };
    const after: Person = { ...before, photos: [...before.photos, photo], updatedAt: photo.uploadedAt };
    await store.putPerson(after);
    await store.putRevision(
      makeRevision('person', after.personId, 'photo_add', before, { nameZh: after.nameZh, year: after.yearJoined }, input.uploadedBy, ['photos']),
    );
    return c.json({ person: after }, 201);
  });

  /** 個人照刪除：從陣列移除；revision 保留改前內容、S3 物件不刪，等同軟刪除，可由「還原」救回。 */
  app.delete('/api/persons/:id/photos', requireToken, async (c) => {
    const before = await loadPerson(c.req.param('id'));
    const key = c.req.query('key');
    const by = c.req.query('by') ?? '';
    if (!key || !before.photos.some((p) => p.s3Key === key)) fail(404, 'not_found', '找不到這張照片');
    const after: Person = { ...before, photos: before.photos.filter((p) => p.s3Key !== key), updatedAt: now() };
    await store.putPerson(after);
    await store.putRevision(
      makeRevision('person', after.personId, 'photo_delete', before, { nameZh: after.nameZh, year: after.yearJoined }, by, ['photos']),
    );
    return c.json({ person: after });
  });

  /* ---------- 上傳（同網域 multipart，由後端寫入 S3） ---------- */

  const MAX_FULL = 4 * 1024 * 1024;
  const MAX_THUMB = 600 * 1024;

  app.post('/api/upload', requireToken, async (c) => {
    const q = c.req.query();
    const meta = uploadUrlInputSchema.safeParse(
      q.kind === 'person' ? { kind: 'person', personId: q.personId, contentType: 'image/jpeg' } : { kind: 'group', year: q.year, contentType: 'image/jpeg' },
    );
    if (!meta.success) fail(400, 'invalid', '上傳參數不正確');
    const input = meta.data;

    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      fail(400, 'invalid', '上傳格式錯誤');
    }
    const full = form.full;
    const thumb = form.thumb;
    if (!(full instanceof File) || !(thumb instanceof File)) fail(400, 'invalid', '缺少照片檔案');
    const contentType = full.type || 'image/jpeg';
    if (!['image/jpeg', 'image/webp'].includes(contentType) || thumb.type !== contentType) fail(400, 'invalid', '只接受 JPEG / WebP');
    if (full.size > MAX_FULL || thumb.size > MAX_THUMB) fail(413, 'too_large', '照片太大，請重新選擇');
    if (full.size === 0 || thumb.size === 0) fail(400, 'invalid', '照片是空的');

    const ext = contentType === 'image/webp' ? 'webp' : 'jpg';
    const photoId = generateId();
    let base: string;
    if (input.kind === 'person') {
      const p = await loadPerson(input.personId);
      if (p.photos.length >= PERSON_LIMITS.photos) fail(409, 'limit_reached', `每人最多 ${PERSON_LIMITS.photos} 張照片，請先刪一張`);
      base = `persons/${p.personId}/${photoId}`;
    } else {
      const existing = await store.listGroupPhotos(input.year as number);
      if (existing.length >= GROUP_LIMITS.photosPerYear)
        fail(409, 'limit_reached', `每個年份最多 ${GROUP_LIMITS.photosPerYear} 張合照，請先刪一張`);
      base = `groups/${input.year}/${photoId}`;
    }
    const s3Key = `${base}.${ext}`;
    const thumbKey = `${base}_t.${ext}`;
    await Promise.all([
      blobs.put(s3Key, new Uint8Array(await full.arrayBuffer()), contentType),
      blobs.put(thumbKey, new Uint8Array(await thumb.arrayBuffer()), contentType),
    ]);
    return c.json({ s3Key, thumbKey });
  });

  /* ---------- 團體照 ---------- */

  app.get('/api/photos', async (c) => {
    const y = c.req.query('year');
    const year = y ? Number(y) : undefined;
    if (y && !Number.isFinite(year)) fail(400, 'invalid', '年份格式錯誤');
    const photos = await store.listGroupPhotos(year);
    photos.sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
    return c.json({ photos });
  });

  app.post('/api/photos', requireToken, async (c) => {
    const input = await parse(c, groupPhotoInputSchema);
    const year = input.year as number;
    const m = GROUP_KEY.exec(input.s3Key);
    const mt = GROUP_KEY.exec(input.thumbKey);
    if (!m || !mt || Number(m[1]) !== year || Number(mt[1]) !== year || m[2] !== mt[2] || m[3] || !mt[3])
      fail(400, 'invalid', '照片路徑不正確');
    const existing = await store.listGroupPhotos(year);
    if (existing.length >= GROUP_LIMITS.photosPerYear)
      fail(409, 'limit_reached', `每個年份最多 ${GROUP_LIMITS.photosPerYear} 張合照，請先刪一張`);
    if (!(await blobs.exists(input.s3Key))) fail(400, 'not_uploaded', '照片尚未上傳完成');
    const photoId = m[2]!;
    if (await store.idExists(photoId)) fail(409, 'conflict', '照片已存在');
    const photo: GroupPhoto = {
      photoId,
      year,
      s3Key: input.s3Key,
      thumbKey: input.thumbKey,
      caption: input.caption,
      status: 'active',
      uploadedAt: now(),
      uploadedBy: input.uploadedBy,
    };
    await store.putGroupPhoto(photo);
    await store.putRevision(makeRevision('groupPhoto', photoId, 'group_photo_add', null, { nameZh: '', year }, input.uploadedBy));
    return c.json({ photo }, 201);
  });

  app.put('/api/photos/:id', requireToken, async (c) => {
    const id = c.req.param('id');
    const before = isValidId(id) ? await store.getGroupPhoto(id) : null;
    if (!before || before.status !== 'active') fail(404, 'not_found', '找不到這張照片');
    const body = (await c.req.json().catch(() => ({}))) as { caption?: unknown; uploadedBy?: unknown };
    const after: GroupPhoto = { ...before, caption: String(body.caption ?? '').trim().slice(0, 200) };
    await store.putGroupPhoto(after);
    await store.putRevision(
      makeRevision('groupPhoto', id, 'update', before, { nameZh: '', year: before.year }, String(body.uploadedBy ?? ''), ['caption']),
    );
    return c.json({ photo: after });
  });

  app.delete('/api/photos/:id', requireToken, async (c) => {
    const id = c.req.param('id');
    const before = isValidId(id) ? await store.getGroupPhoto(id) : null;
    if (!before || before.status !== 'active') fail(404, 'not_found', '找不到這張照片');
    const after: GroupPhoto = { ...before, status: 'hidden' };
    await store.putGroupPhoto(after);
    await store.putRevision(
      makeRevision('groupPhoto', id, 'group_photo_delete', before, { nameZh: '', year: before.year }, c.req.query('by') ?? '', ['status']),
    );
    return c.json({ ok: true });
  });

  /* ---------- 最近更新 ---------- */

  app.get('/api/recent', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 8) || 8, 30);
    const revs = await store.listRecent(limit);
    const recent = revs.map(({ before, ...rest }) => {
      void before;
      return rest;
    });
    return c.json({ recent });
  });

  /* ---------- 管理者後門 ---------- */

  app.post('/api/admin/hide', requireAdmin, async (c) => {
    const input = await parse(c, adminHideInputSchema);
    const kind: RevisionKind = input.action === 'hide' ? 'admin_hide' : 'admin_unhide';
    if (input.target === 'person') {
      const before = await store.getPerson(input.id);
      if (!before) fail(404, 'not_found', '找不到這個人');
      const after: Person = { ...before, status: input.action === 'hide' ? 'hidden' : 'active', updatedAt: now() };
      await store.putPerson(after);
      await store.putRevision(makeRevision('person', input.id, kind, before, { nameZh: before.nameZh, year: before.yearJoined }, 'admin', ['status']));
      return c.json({ person: after });
    }
    if (input.target === 'groupPhoto') {
      const before = await store.getGroupPhoto(input.id);
      if (!before) fail(404, 'not_found', '找不到這張照片');
      const after: GroupPhoto = { ...before, status: input.action === 'hide' ? 'hidden' : 'active' };
      await store.putGroupPhoto(after);
      await store.putRevision(makeRevision('groupPhoto', input.id, kind, before, { nameZh: '', year: before.year }, 'admin', ['status']));
      return c.json({ photo: after });
    }
    // personPhoto：從陣列移除（revision 保留，可還原）
    const before = await store.getPerson(input.id);
    if (!before) fail(404, 'not_found', '找不到這個人');
    if (!input.s3Key || !before.photos.some((p) => p.s3Key === input.s3Key)) fail(404, 'not_found', '找不到這張照片');
    const after: Person = { ...before, photos: before.photos.filter((p) => p.s3Key !== input.s3Key), updatedAt: now() };
    await store.putPerson(after);
    await store.putRevision(makeRevision('person', input.id, 'admin_hide', before, { nameZh: before.nameZh, year: before.yearJoined }, 'admin', ['photos']));
    return c.json({ person: after });
  });

  app.notFound((c) => c.json({ error: 'not_found', message: '找不到這個端點' }, 404));

  return app;
}

export type App = ReturnType<typeof createApp>;
