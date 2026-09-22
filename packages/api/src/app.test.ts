import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { FileStore } from './store/file.js';
import type { Blobs } from './blobs/types.js';
import type { Person } from '@vsp/shared';

const uploaded = new Map<string, number>();
const blobs: Blobs = {
  async put(key, body) {
    uploaded.set(key, body.byteLength);
  },
  async exists(key) {
    return uploaded.has(key);
  },
};

/** 模擬前端的 multipart 上傳 */
function upload(query: string, fullSize = 1000, thumbSize = 100) {
  const fd = new FormData();
  fd.append('full', new File([new Uint8Array(fullSize)], 'full.jpg', { type: 'image/jpeg' }));
  fd.append('thumb', new File([new Uint8Array(thumbSize)], 'thumb.jpg', { type: 'image/jpeg' }));
  return app.request(`/api/upload?${query}`, { method: 'POST', headers: { 'x-write-token': token }, body: fd });
}
const secrets = async () => ({
  passphraseQuestion: 'Q?',
  passphraseAnswer: 'ABC',
  tokenSecret: 's',
  adminKey: 'admin',
});

let app: ReturnType<typeof createApp>;
let token = '';

async function json(res: Response) {
  return (await res.json()) as any;
}
function req(path: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}, withToken = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withToken) headers['x-write-token'] = token;
  return app.request(path, { ...init, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) } as RequestInit);
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vsp-'));
  app = createApp({ store: new FileStore(join(dir, 'db.json')), blobs, secrets, writeRateLimit: 100 });
  uploaded.clear();
  const r = await req('/api/verify', { method: 'POST', body: { answer: ' a b c ' } }, false);
  token = (await json(r)).token;
});

describe('暗號', () => {
  it('沒 token 的寫入回 401 並附題目', async () => {
    const r = await req('/api/persons', { method: 'POST', body: { nameZh: '張三', yearJoined: 1985 } }, false);
    expect(r.status).toBe(401);
    expect((await json(r)).question).toBe('Q?');
  });
  it('答錯回 400', async () => {
    const r = await req('/api/verify', { method: 'POST', body: { answer: 'XYZ' } }, false);
    expect(r.status).toBe(400);
  });
  it('瀏覽不需 token', async () => {
    expect((await req('/api/persons', {}, false)).status).toBe(200);
    expect((await req('/api/recent', {}, false)).status).toBe(200);
  });
});

describe('Person', () => {
  it('新增 → 更新 → 修改紀錄 → 還原', async () => {
    const created = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '張三', yearJoined: '1985', updatedBy: '小王' } }));
    const p: Person = created.person;
    expect(p.personId).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(p.hasMaster).toBe('unknown');

    const upd = await json(
      await req(`/api/persons/${p.personId}`, { method: 'PUT', body: { ...p, hasMaster: 'yes', masterThesis: '論文A', updatedBy: '小李' } }),
    );
    expect(upd.person.masterThesis).toBe('論文A');

    const detail = await json(await req(`/api/persons/${p.personId}`, {}, false));
    expect(detail.revisions).toHaveLength(2);
    expect(detail.revisions[0].kind).toBe('update');
    expect(detail.revisions[0].changedFields).toEqual(expect.arrayContaining(['hasMaster', 'masterThesis']));
    expect(detail.revisions[0].before.masterThesis).toBe('');

    const restored = await json(
      await req(`/api/persons/${p.personId}`, {
        method: 'PUT',
        body: { ...detail.revisions[0].before, restoreOf: detail.revisions[0].revId, updatedBy: '' },
      }),
    );
    expect(restored.person.masterThesis).toBe('');
    const recent = await json(await req('/api/recent', {}, false));
    expect(recent.recent[0].kind).toBe('restore');
    expect(recent.recent[0].before).toBeUndefined();
  });

  it('無變更不寫 revision', async () => {
    const { person } = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '李四', yearJoined: 1990 } }));
    const r = await json(await req(`/api/persons/${person.personId}`, { method: 'PUT', body: person }));
    expect(r.unchanged).toBe(true);
  });

  it('合併：保留 keep、drop 標 hidden 指向 keep', async () => {
    const a = (await json(await req('/api/persons', { method: 'POST', body: { nameZh: '王五', yearJoined: 1988, nameEn: 'Wang' } }))).person;
    const b = (await json(await req('/api/persons', { method: 'POST', body: { nameZh: '王五', yearJoined: 1988, nickname: '小五' } }))).person;
    const r = await req('/api/persons/merge', {
      method: 'POST',
      body: { keepId: a.personId, dropId: b.personId, merged: { ...a, nickname: '小五' }, photos: [] },
    });
    expect(r.status).toBe(200);
    const list = (await json(await req('/api/persons', {}, false))).persons;
    expect(list).toHaveLength(1);
    expect(list[0].nickname).toBe('小五');
    const dropped = await json(await req(`/api/persons/${b.personId}`, {}, false));
    expect(dropped.person.status).toBe('hidden');
    expect(dropped.person.mergedInto).toBe(a.personId);
  });
});

describe('照片', () => {
  it('個人照上限 2 張，滿了回 409 且訊息明確', async () => {
    const { person } = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '趙六', yearJoined: 1995 } }));
    for (let i = 0; i < 2; i++) {
      const up = await upload(`kind=person&personId=${person.personId}`);
      expect(up.status).toBe(200);
      const u = await json(up);
      expect(uploaded.get(u.s3Key)).toBe(1000);
      expect(uploaded.get(u.thumbKey)).toBe(100);
      const r = await req(`/api/persons/${person.personId}/photos`, { method: 'POST', body: { s3Key: u.s3Key, thumbKey: u.thumbKey } });
      expect(r.status).toBe(201);
    }
    const r = await upload(`kind=person&personId=${person.personId}`);
    expect(r.status).toBe(409);
    expect((await json(r)).message).toContain('請先刪一張');
  });

  it('刪個人照後可從修改紀錄還原', async () => {
    const { person } = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '孫七', yearJoined: 1999 } }));
    const u = await json(await upload(`kind=person&personId=${person.personId}`));
    await req(`/api/persons/${person.personId}/photos`, { method: 'POST', body: { s3Key: u.s3Key, thumbKey: u.thumbKey } });
    const del = await json(await req(`/api/persons/${person.personId}/photos?key=${encodeURIComponent(u.s3Key)}`, { method: 'DELETE' }));
    expect(del.person.photos).toHaveLength(0);
    const detail = await json(await req(`/api/persons/${person.personId}`, {}, false));
    const rev = detail.revisions.find((r: any) => r.kind === 'photo_delete');
    const restored = await json(await req(`/api/persons/${person.personId}`, { method: 'PUT', body: { ...rev.before, restoreOf: rev.revId } }));
    expect(restored.person.photos).toHaveLength(1);
  });

  it('太大的檔案回 413；沒上傳就登記回 400', async () => {
    const { person } = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '大檔', yearJoined: 1999 } }));
    expect((await upload(`kind=person&personId=${person.personId}`, 5 * 1024 * 1024)).status).toBe(413);
    const r = await req(`/api/persons/${person.personId}/photos`, { method: 'POST', body: { s3Key: `persons/${person.personId}/abcdef.jpg`, thumbKey: `persons/${person.personId}/abcdef_t.jpg` } });
    expect(r.status).toBe(400);
  });

  it('團體照：上傳、列出、軟刪除', async () => {
    const u = await json(await upload('kind=group&year=1985'));
    expect(u.s3Key).toMatch(/^groups\/1985\//);
    const created = await json(await req('/api/photos', { method: 'POST', body: { year: 1985, s3Key: u.s3Key, thumbKey: u.thumbKey, caption: '畢業' } }));
    expect(created.photo.status).toBe('active');
    expect((await json(await req('/api/photos?year=1985', {}, false))).photos).toHaveLength(1);
    await req(`/api/photos/${created.photo.photoId}`, { method: 'DELETE' });
    expect((await json(await req('/api/photos?year=1985', {}, false))).photos).toHaveLength(0);
  });
});

describe('管理者', () => {
  it('錯密鑰 403，正確可隱藏', async () => {
    const { person } = await json(await req('/api/persons', { method: 'POST', body: { nameZh: '周八', yearJoined: 2000 } }));
    const bad = await app.request('/api/admin/hide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'nope' },
      body: JSON.stringify({ target: 'person', id: person.personId }),
    });
    expect(bad.status).toBe(403);
    const ok = await app.request('/api/admin/hide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'admin' },
      body: JSON.stringify({ target: 'person', id: person.personId }),
    });
    expect(ok.status).toBe(200);
    expect((await json(await req('/api/persons', {}, false))).persons).toHaveLength(0);
  });
});

describe('rate limit', () => {
  it('超過次數回 429', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vsp-'));
    app = createApp({ store: new FileStore(join(dir, 'db.json')), blobs, secrets, writeRateLimit: 2 });
    const body = { nameZh: 'X', yearJoined: 1980 };
    expect((await req('/api/persons', { method: 'POST', body })).status).toBe(201);
    expect((await req('/api/persons', { method: 'POST', body })).status).toBe(201);
    expect((await req('/api/persons', { method: 'POST', body })).status).toBe(429);
  });

  it('偽造 CloudFront-Viewer-Address 繞不過：沒有 X-Origin-Verify 就不採信', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vsp-'));
    app = createApp({ store: new FileStore(join(dir, 'db.json')), blobs, secrets, writeRateLimit: 2, originSecret: 'cf-secret' });
    const post = (ip: string, verify?: string) =>
      app.request('/api/persons', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-write-token': token,
          'cloudfront-viewer-address': `${ip}:12345`,
          ...(verify ? { 'x-origin-verify': verify } : {}),
        },
        body: JSON.stringify({ nameZh: 'X', yearJoined: 1980 }),
      });
    // 直接打 API Gateway、每次換一個假 IP：全部落在同一個桶，第三次就被擋
    expect((await post('10.0.0.1')).status).toBe(201);
    expect((await post('10.0.0.2', 'wrong')).status).toBe(201);
    expect((await post('10.0.0.3')).status).toBe(429);
    // 真的經過 CloudFront（header 對得上）：不同 viewer IP 各自計算
    expect((await post('10.0.0.4', 'cf-secret')).status).toBe(201);
    expect((await post('10.0.0.5', 'cf-secret')).status).toBe(201);
  });
});
