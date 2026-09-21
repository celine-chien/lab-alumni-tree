/**
 * 暗號答案比對要寬鬆：去空白、不分大小寫、全半形正規化。
 * 這是防機器人不是入學考試，答對率要接近 100%。
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC') // 全形 → 半形
    .replace(/[\s　]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '') // 去標點
    .toUpperCase();
}
