/**
 * 照片儲存。前端先壓縮（原圖長邊 ~1600px、縮圖 ~400px），
 * 以 multipart 送到同網域的 POST /api/upload，由後端寫入 S3。
 *
 * 原本設計是 presigned URL 由瀏覽器直接 PUT S3，但 iOS Safari 對跨網域 PUT
 * 會出現「Load failed」，改走同網域後完全不需要 CORS。
 * 此規模（每張 < 1MB、總量數百張）經過 Lambda 的成本可忽略。
 *
 * 正式環境為 S3；本機開發存在 .data/photos/。
 * 照片「刪除」一律軟刪除，不呼叫任何 delete。
 */
export interface Blobs {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** 建立紀錄前確認物件真的存在。 */
  exists(key: string): Promise<boolean>;
}
