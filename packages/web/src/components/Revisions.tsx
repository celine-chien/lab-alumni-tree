import { useEffect, useState } from 'preact/hooks';
import type { Person, Revision } from '@vsp/shared';
import { describeRevision, personToInput } from '@vsp/shared';
import { api, ApiError, who } from '../lib/api.js';
import { confirmDialog, toast } from '../lib/dialogs.js';
import { fmtTime } from '../lib/format.js';

/** 修改紀錄／還原。還原 = 把該筆 revision 的 before（改前完整內容，含照片）再存一次。 */
export function Revisions({ person, onUpdated }: { person: Person; onUpdated: (p: Person) => void }) {
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRevs(null);
    api.getPerson(person.personId).then((r) => setRevs(r.revisions)).catch((e) => setError(e.message));
  }, [person.personId, person.updatedAt]);

  async function restore(rev: Revision) {
    const before = rev.before as Person;
    const ok = await confirmDialog({
      title: '還原到這次修改之前？',
      message: `會把 ${fmtTime(rev.ts)} 之前的內容（含照片）存成最新版本；這個動作本身也會留下紀錄。`,
      okLabel: '還原',
    });
    if (!ok) return;
    try {
      const updated = await api.updatePerson(person.personId, { ...personToInput(before), photos: before.photos, restoreOf: rev.revId, updatedBy: who.get() });
      onUpdated(updated);
      toast('已還原');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') return;
      toast(e instanceof Error ? e.message : '還原失敗');
    }
  }

  if (error) return <div class="error">{error}</div>;
  if (!revs) return <div class="muted small">載入中…</div>;
  if (revs.length === 0) return <div class="muted small">還沒有修改紀錄</div>;
  return (
    <ol class="revs">
      {revs.map((r) => (
        <li key={r.revId}>
          <div>
            <span class="small muted">{fmtTime(r.ts)}</span>
            {r.by && <span class="small muted">・{r.by}</span>}
          </div>
          <div>{describeRevision(r)}</div>
          {r.before && r.kind !== 'merged_away' && (
            <button class="btn btn-sm" onClick={() => restore(r)}>還原到這之前</button>
          )}
        </li>
      ))}
    </ol>
  );
}
