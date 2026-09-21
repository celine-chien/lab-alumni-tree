import type { GroupPhoto, Person, PersonInput, RecentItem, Revision, MergeInput } from '@vsp/shared';
import { passphraseDialog } from './dialogs.js';

const TOKEN_KEY = 'vsp.writeToken';
const WHO_KEY = 'vsp.who';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) };
  if (headers['content-type'] === '') delete headers['content-type']; // FormData：讓瀏覽器自己帶 boundary
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', '連線失敗，請確認網路後再試一次');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'error'), String(body.message ?? `HTTP ${res.status}`), body);
  return body as T;
}

/** 選填署名：記在 localStorage，下次自動帶入。 */
export const who = {
  get(): string {
    try { return localStorage.getItem(WHO_KEY) ?? ''; } catch { return ''; }
  },
  set(v: string) {
    try { localStorage.setItem(WHO_KEY, v); } catch { /* ignore */ }
  },
};

function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

/**
 * 寫入：自動帶 token。收到 401 token_required 時跳暗號題，答對後存 token 並重送一次。
 * 瀏覽用的 GET 不走這裡。
 */
async function write<T>(path: string, init: RequestInit = {}): Promise<T> {
  const attempt = () => request<T>(path, { ...init, headers: { ...(init.headers ?? {}), 'x-write-token': getToken() } });
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'token_required') throw e;
    const ok = await passphraseDialog(String(e.body.question ?? ''), async (answer) => {
      try {
        const r = await request<{ token: string }>('/api/verify', { method: 'POST', body: JSON.stringify({ answer }) });
        try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ }
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError && err.code === 'wrong_answer') return { ok: false, message: err.message };
        throw err;
      }
    });
    if (!ok) throw new ApiError(0, 'cancelled', '已取消');
    return attempt();
  }
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  listPersons: () => request<{ persons: Person[] }>('/api/persons').then((r) => r.persons),
  getPerson: (id: string) => request<{ person: Person; revisions: Revision[] }>(`/api/persons/${id}`),
  recent: () => request<{ recent: RecentItem[] }>('/api/recent').then((r) => r.recent),
  listGroupPhotos: (year: number) => request<{ photos: GroupPhoto[] }>(`/api/photos?year=${year}`).then((r) => r.photos),

  createPerson: (input: PersonInput) => write<{ person: Person }>('/api/persons', { method: 'POST', body: json(input) }).then((r) => r.person),
  updatePerson: (id: string, input: PersonInput & { restoreOf?: string; photos?: Person['photos'] }) =>
    write<{ person: Person }>(`/api/persons/${id}`, { method: 'PUT', body: json(input) }).then((r) => r.person),
  merge: (input: MergeInput) => write<{ person: Person }>('/api/persons/merge', { method: 'POST', body: json(input) }).then((r) => r.person),

  /** 同網域 multipart 上傳（原圖 + 縮圖），後端寫入 S3 後回傳 key。 */
  upload: (target: { kind: 'person'; personId: string } | { kind: 'group'; year: number }, full: Blob, thumb: Blob) => {
    const fd = new FormData();
    fd.append('full', full, 'full.jpg');
    fd.append('thumb', thumb, 'thumb.jpg');
    const q = target.kind === 'person' ? `kind=person&personId=${target.personId}` : `kind=group&year=${target.year}`;
    return write<{ s3Key: string; thumbKey: string }>(`/api/upload?${q}`, { method: 'POST', body: fd, headers: { 'content-type': '' } });
  },
  addPersonPhoto: (id: string, input: { s3Key: string; thumbKey: string; caption: string; uploadedBy: string }) =>
    write<{ person: Person }>(`/api/persons/${id}/photos`, { method: 'POST', body: json(input) }).then((r) => r.person),
  deletePersonPhoto: (id: string, s3Key: string, by: string) =>
    write<{ person: Person }>(`/api/persons/${id}/photos?key=${encodeURIComponent(s3Key)}&by=${encodeURIComponent(by)}`, { method: 'DELETE' }).then((r) => r.person),

  addGroupPhoto: (input: { year: number; s3Key: string; thumbKey: string; caption: string; uploadedBy: string }) =>
    write<{ photo: GroupPhoto }>('/api/photos', { method: 'POST', body: json(input) }).then((r) => r.photo),
  updateGroupPhoto: (id: string, caption: string, by: string) =>
    write<{ photo: GroupPhoto }>(`/api/photos/${id}`, { method: 'PUT', body: json({ caption, uploadedBy: by }) }).then((r) => r.photo),
  deleteGroupPhoto: (id: string, by: string) => write<{ ok: true }>(`/api/photos/${id}?by=${encodeURIComponent(by)}`, { method: 'DELETE' }),
};

export const photoUrl = (key: string) => `/photos/${key}`;
