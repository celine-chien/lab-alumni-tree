import { useState } from 'preact/hooks';
import type { Person, PersonPhoto } from '@vsp/shared';
import { PERSON_LIMITS } from '@vsp/shared';
import { api, ApiError, photoUrl, who } from '../lib/api.js';
import { uploadPersonPhoto } from '../lib/uploadPhoto.js';
import { confirmDialog, toast } from '../lib/dialogs.js';
import { fmtTime } from '../lib/format.js';
import { Lightbox } from './Lightbox.jsx';

/**
 * 人物面板內的個人照：最多 2 張，沒有時顯示淡色「＋ 新增照片」空位（不放灰色預設頭像）。
 * 在面板內即時上傳，不經過編輯表單——上傳是順手的衝動行為。
 */
export function PersonPhotos({ person, onUpdated }: { person: Person; onUpdated: (p: Person) => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<PersonPhoto | null>(null);
  const slots = Math.max(0, PERSON_LIMITS.photos - person.photos.length);

  async function upload() {
    setBusy(true);
    const updated = await uploadPersonPhoto(person);
    setBusy(false);
    if (updated) onUpdated(updated);
  }

  async function remove(p: PersonPhoto) {
    const ok = await confirmDialog({ title: '刪除這張照片？', message: '可從「修改紀錄」還原。', okLabel: '刪除', danger: true });
    if (!ok) return;
    try {
      const updated = await api.deletePersonPhoto(person.personId, p.s3Key, who.get());
      onUpdated(updated);
      setOpen(null);
      toast('已刪除');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') return;
      toast(e instanceof Error ? e.message : '刪除失敗');
    }
  }

  return (
    <div class="pphotos">
      {person.photos.map((p) => (
        <button key={p.s3Key} class="pphoto" onClick={() => setOpen(p)} aria-label="查看照片">
          <img src={photoUrl(p.thumbKey)} alt={p.caption || person.nameZh} />
        </button>
      ))}
      {Array.from({ length: slots }, (_, i) => (
        <button key={`slot${i}`} class="pphoto pphoto-empty" onClick={upload} disabled={busy}>
          {busy && i === 0 ? '上傳中…' : '＋ 新增照片'}
        </button>
      ))}
      {open && (
        <Lightbox
          src={photoUrl(open.s3Key)}
          alt={person.nameZh}
          caption={open.caption}
          meta={`${fmtTime(open.uploadedAt)}${open.uploadedBy ? `・${open.uploadedBy}` : ''}`}
          onClose={() => setOpen(null)}
          actions={<button class="btn btn-sm btn-danger" onClick={() => remove(open)}>刪除</button>}
        />
      )}
    </div>
  );
}
