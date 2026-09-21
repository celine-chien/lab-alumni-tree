/**
 * bottom sheet / lightbox 開啟時鎖住背景捲動（參考計數，可疊多層）。
 * 手機上若不鎖，滑面板內容時背景清單會跟著跑，是 bottom sheet 最常見的 bug。
 * 用 position:fixed + top:-scrollY 的做法，iOS Safari 也有效；全部關閉時還原捲動位置，
 * 因此底層清單從未移動，關閉後自然回到原位。
 */
let count = 0;
let savedY = 0;

export function lockScroll() {
  count += 1;
  if (count > 1) return;
  savedY = window.scrollY;
  const b = document.body;
  b.style.position = 'fixed';
  b.style.top = `-${savedY}px`;
  b.style.left = '0';
  b.style.right = '0';
  b.style.width = '100%';
  b.style.overflow = 'hidden';
}

export function unlockScroll() {
  if (count === 0) return;
  count -= 1;
  if (count > 0) return;
  const b = document.body;
  b.style.position = '';
  b.style.top = '';
  b.style.left = '';
  b.style.right = '';
  b.style.width = '';
  b.style.overflow = '';
  window.scrollTo(0, savedY);
}
