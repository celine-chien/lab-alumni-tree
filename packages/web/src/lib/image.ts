/**
 * 前端壓縮：原圖長邊約 1600px、縮圖長邊約 400px，輸出 JPEG。
 * 老照片翻拍手機直拍動輒 5MB，不壓縮會拖垮 S3 費用與載入速度。
 */
export interface Compressed {
  full: Blob;
  thumb: Blob;
}

const CONTENT_TYPE = 'image/jpeg';

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 舊瀏覽器 fallback */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法讀取圖片'));
    img.src = URL.createObjectURL(file);
  });
}

function draw(src: ImageBitmap | HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('壓縮失敗'))), CONTENT_TYPE, quality);
  });
}

export async function compressImage(file: File): Promise<Compressed> {
  const src = await loadBitmap(file);
  const [full, thumb] = await Promise.all([draw(src, 1600, 0.85), draw(src, 400, 0.8)]);
  if ('close' in src) src.close();
  return { full, thumb };
}

export const IMAGE_CONTENT_TYPE = CONTENT_TYPE;

/**
 * 開檔案選擇器；使用者取消時回 null。
 * 不用 window focus 來偵測取消：iOS 從相簿選完（HEIC 轉檔）常超過一秒才觸發 change，
 * 用 focus + timeout 會把正常選擇誤判成取消。改聽 cancel 事件（舊瀏覽器沒有就讓 promise 懸著，無害）。
 */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    const done = (f: File | null) => {
      resolve(f);
      input.remove();
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}
