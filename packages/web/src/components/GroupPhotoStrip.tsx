import { useEffect, useState } from 'preact/hooks';
import type { GroupPhoto } from '@vsp/shared';
import { GROUP_LIMITS } from '@vsp/shared';
import { api, ApiError, photoUrl, who } from '../lib/api.js';
import { compressImage, pickImage } from '../lib/image.js';
import { confirmDialog, promptDialog, toast } from '../lib/dialogs.js';
import { fmtTime } from '../lib/format.js';
import { Lightbox } from './Lightbox.jsx';

/** 年份區塊下方的團體照橫向照片帶。最後一格固定是「＋ 新增合照」。 */
export function GroupPhotoStrip({ year }: { year: number }) {
  const [photos, setPhotos] = useState<GroupPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<GroupPhoto | null>(null);

  useEffect(() => {
    api.listGroupPhotos(year).then(setPhotos).catch(() => setPhotos([]));
  }, [year]);

  async function upload() {
    if (photos && photos.length >= GROUP_LIMITS.photosPerYear) {
      toast(`每個年份最多 ${GROUP_LIMITS.photosPerYear} 張合照，請先刪一張`);
      return;
    }
    const file = await pickImage();
    if (!file) return;
    setBusy(true);
    try {
      const { full, thumb } = await compressImage(file);
      const u = await api.upload({ kind: 'group', year }, full, thumb);
      const caption = (await promptDialog({ title: '照片說明（選填）', placeholder: '例如：1985 畢業聚餐', okLabel: '儲存', skipLabel: '跳過' })) ?? '';
      const photo = await api.addGroupPhoto({ year, s3Key: u.s3Key, thumbKey: u.thumbKey, caption, uploadedBy: who.get() });
      setPhotos((ps) => [...(ps ?? []), photo]);
      toast('合照已新增');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') return;
      toast(e instanceof Error ? e.message : '上傳失敗');
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: GroupPhoto) {
    const ok = await confirmDialog({ title: '刪除這張合照？', message: '會保留修改紀錄，管理者可以救回。', okLabel: '刪除', danger: true });
    if (!ok) return;
    try {
      await api.deleteGroupPhoto(p.photoId, who.get());
      setPhotos((ps) => (ps ?? []).filter((x) => x.photoId !== p.photoId));
      setOpen(null);
      toast('已刪除');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') return;
      toast(e instanceof Error ? e.message : '刪除失敗');
    }
  }

  async function editCaption(p: GroupPhoto) {
    const caption = await promptDialog({ title: '照片說明', value: p.caption, okLabel: '儲存' });
    if (caption === null) return;
    try {
      const updated = await api.updateGroupPhoto(p.photoId, caption, who.get());
      setPhotos((ps) => (ps ?? []).map((x) => (x.photoId === p.photoId ? updated : x)));
      setOpen(updated);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') return;
      toast(e instanceof Error ? e.message : '儲存失敗');
    }
  }

  return (
    <div class="strip-wrap">
      <div class="strip-title text-2 small">合照{photos && photos.length > 0 ? `・${photos.length} 張` : ''}</div>
      <div class="strip" role="list">
        {photos === null && <div class="strip-tile muted">載入中…</div>}
        {photos?.map((p) => (
          <button key={p.photoId} class="strip-tile strip-photo" role="listitem" onClick={() => setOpen(p)} aria-label={p.caption || '合照'}>
            <img src={photoUrl(p.thumbKey)} alt={p.caption} loading="lazy" />
            {p.caption && <span class="strip-caption">{p.caption}</span>}
          </button>
        ))}
        <button class="strip-tile strip-add" role="listitem" onClick={upload} disabled={busy}>
          {busy ? '上傳中…' : '＋ 新增合照'}
        </button>
      </div>
      {open && (
        <Lightbox
          src={photoUrl(open.s3Key)}
          alt={open.caption}
          caption={open.caption}
          meta={`${year} 年合照・${fmtTime(open.uploadedAt)}${open.uploadedBy ? `・${open.uploadedBy}` : ''}`}
          onClose={() => setOpen(null)}
          actions={
            <>
              <button class="btn btn-sm" onClick={() => editCaption(open)}>改說明</button>
              <button class="btn btn-sm btn-danger" onClick={() => remove(open)}>刪除</button>
            </>
          }
        />
      )}
    </div>
  );
}
