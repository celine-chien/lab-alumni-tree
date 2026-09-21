/**
 * personId / photoId 產生規則：
 * - 6 碼英數字，去除易混淆字元 0 / O / 1 / l / I
 * - 隨機產生，寫入前由呼叫端查詢確認未重複
 * - 不可用年份編碼：入實驗室年可被修改，id 必須永遠不變
 */
export const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const ID_LENGTH = 6;
export const ID_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{6}$/;

function randomInt(max: number): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

export function generateId(): string {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

export function isValidId(s: unknown): s is string {
  return typeof s === 'string' && ID_PATTERN.test(s);
}

/** 產生一個未重複的 id；exists 由呼叫端提供（查 DB）。 */
export async function generateUniqueId(exists: (id: string) => Promise<boolean>): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const id = generateId();
    if (!(await exists(id))) return id;
  }
  throw new Error('無法產生未重複的 id');
}
