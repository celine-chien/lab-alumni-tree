import type { Person } from '@vsp/shared';
import { api, ApiError, who } from './api.js';
import { compressImage, pickImage } from './image.js';
import { toast } from './dialogs.js';

/**
 * 個人照上傳：選檔 → 壓縮 → 上傳 → 登記。卡片右側的空框與人物面板共用。
 * 回傳更新後的 Person；使用者取消或失敗回 null（失敗會 toast）。
 */
export async function uploadPersonPhoto(person: Person): Promise<Person | null> {
  const file = await pickImage();
  if (!file) return null;
  try {
    const { full, thumb } = await compressImage(file);
    const u = await api.upload({ kind: 'person', personId: person.personId }, full, thumb);
    const updated = await api.addPersonPhoto(person.personId, { s3Key: u.s3Key, thumbKey: u.thumbKey, caption: '', uploadedBy: who.get() });
    toast('照片已新增');
    return updated;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'cancelled') return null;
    toast(e instanceof Error ? e.message : '上傳失敗');
    return null;
  }
}
