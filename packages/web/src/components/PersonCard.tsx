import { useState } from 'preact/hooks';
import type { Person } from '@vsp/shared';
import { missingFields } from '@vsp/shared';
import { photoUrl } from '../lib/api.js';
import { uploadPersonPhoto } from '../lib/uploadPhoto.js';

const MAX_SHOWN = 2;

/**
 * 格狀清單的一格。左區：姓名、學位徽章、缺漏文字（寫欄位名不寫數字，最多 2 項）。
 * 右區：照片縮圖，沒有時是低視覺重量的虛線框，點了直接叫出相簿（不開面板）。
 */
export function PersonCard({ person, onOpen, onUpdated }: { person: Person; onOpen: (id: string) => void; onUpdated: (p: Person) => void }) {
  const [busy, setBusy] = useState(false);
  const missing = missingFields(person);
  const shown = missing.slice(0, MAX_SHOWN);
  const rest = missing.length - shown.length;
  const thumb = person.photos[0];

  async function upload(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const updated = await uploadPersonPhoto(person);
    setBusy(false);
    if (updated) onUpdated(updated);
  }

  return (
    <div class="pcard" id={`p-${person.personId}`} role="button" tabIndex={0} onClick={() => onOpen(person.personId)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(person.personId))} aria-label={`${person.nameZh}，查看資料`}>
      <div class="pcard-main">
        <span class="pcard-name">{person.nameZh}</span>
        {(person.hasMaster === 'yes' || person.hasPhd === 'yes' || (person.hasMaster === 'no' && person.hasPhd === 'no')) && (
          <span class="pcard-badges">
            {person.hasMaster === 'yes' && <span class="badge badge-master">碩</span>}
            {person.hasPhd === 'yes' && <span class="badge badge-phd">博</span>}
            {person.hasMaster === 'no' && person.hasPhd === 'no' && <span class="badge badge-none">無學位</span>}
          </span>
        )}
        {missing.length > 0 && (
          <span class="pcard-missing" title={`缺 ${missing.join('、')}`}>
            缺 {shown.join(' · ')}{rest > 0 && <span> +{rest}</span>}
          </span>
        )}
      </div>
      {thumb ? (
        <img class="pcard-thumb" src={photoUrl(thumb.thumbKey)} alt="" loading="lazy" />
      ) : (
        <button class="pcard-photo-add" onClick={upload} disabled={busy} aria-label={`為 ${person.nameZh} 新增照片`} title="新增照片">
          <span class="pcard-photo-box" aria-hidden="true">{busy ? '…' : '＋'}</span>
        </button>
      )}
    </div>
  );
}
