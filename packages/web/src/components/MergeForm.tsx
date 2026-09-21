import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Person, PersonInput, PersonPhoto } from '@vsp/shared';
import { FIELD_LABELS, PERSON_INPUT_FIELDS, PERSON_LIMITS, personToInput, softKey } from '@vsp/shared';
import { api, ApiError, photoUrl, who } from '../lib/api.js';
import { confirmDialog, toast } from '../lib/dialogs.js';

const MERGE_RE = /^\/p\/([A-Za-z0-9]{6})\/merge\/?$/;

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（空）';
  if (v === 'yes') return '有';
  if (v === 'no') return '確定沒有';
  if (v === 'unknown') return '不知道';
  return String(v);
}

/**
 * 合併兩筆重複資料。畫面顯示雙方 personId 供確認；
 * 逐欄選擇保留哪一邊，照片合併後超過 2 張要使用者取捨。
 */
export function MergeForm() {
  const leftId = useMemo(() => MERGE_RE.exec(location.pathname)?.[1] ?? null, []);
  const [rightId, setRightId] = useState<string | null>(() => new URLSearchParams(location.search).get('with'));
  const [all, setAll] = useState<Person[]>([]);
  const [left, setLeft] = useState<Person | null>(null);
  const [right, setRight] = useState<Person | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Record<string, 'L' | 'R'>>({});
  const [photos, setPhotos] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<'L' | 'R'>('L');
  const [by, setBy] = useState(who.get());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listPersons().then(setAll).catch((e: Error) => setError(e.message));
    if (leftId) api.getPerson(leftId).then((r) => setLeft(r.person)).catch((e: Error) => setError(e.message));
  }, [leftId]);

  useEffect(() => {
    if (!rightId) { setRight(null); return; }
    api.getPerson(rightId).then((r) => setRight(r.person)).catch((e: Error) => setError(e.message));
  }, [rightId]);

  // 預設：兩邊不同時，優先保留非空的那邊；都非空則保留左邊
  useEffect(() => {
    if (!left || !right) return;
    const p: Record<string, 'L' | 'R'> = {};
    for (const f of PERSON_INPUT_FIELDS) {
      const l = left[f];
      const r = right[f];
      const lEmpty = l === null || l === '' || l === 'unknown';
      const rEmpty = r === null || r === '' || r === 'unknown';
      p[f] = lEmpty && !rEmpty ? 'R' : 'L';
    }
    setPick(p);
    setPhotos(new Set([...left.photos, ...right.photos].slice(0, PERSON_LIMITS.photos).map((x) => x.s3Key)));
  }, [left?.personId, right?.personId]);

  const candidates = useMemo(() => {
    if (!left) return [];
    const others = all.filter((p) => p.personId !== left.personId);
    const same = others.filter((p) => softKey(p.nameZh, p.yearJoined) === softKey(left.nameZh, left.yearJoined) || p.nameZh === left.nameZh);
    if (!q.trim()) return same;
    const s = q.trim();
    return others.filter((p) => p.nameZh.includes(s) || p.nameEn.toLowerCase().includes(s.toLowerCase()) || p.personId === s || String(p.yearJoined) === s);
  }, [all, left, q]);

  async function submit() {
    if (!left || !right) return;
    const keepP = keep === 'L' ? left : right;
    const dropP = keep === 'L' ? right : left;
    const merged = personToInput(left);
    for (const f of PERSON_INPUT_FIELDS) (merged as Record<string, unknown>)[f] = (pick[f] === 'R' ? right : left)[f];
    merged.updatedBy = by;
    const pool = [...left.photos, ...right.photos];
    const chosen: PersonPhoto[] = pool.filter((p) => photos.has(p.s3Key));
    if (chosen.length > PERSON_LIMITS.photos) { setError(`照片最多保留 ${PERSON_LIMITS.photos} 張，請取消勾選`); return; }
    const ok = await confirmDialog({
      title: '確認合併？',
      message: `保留 ${keepP.nameZh}（ID ${keepP.personId}），${dropP.nameZh}（ID ${dropP.personId}）會被隱藏並指向保留的那筆。兩邊都會留下修改紀錄。`,
      okLabel: '合併',
    });
    if (!ok) return;
    setSaving(true);
    who.set(by);
    try {
      const p = await api.merge({ keepId: keepP.personId, dropId: dropP.personId, merged: merged as PersonInput, photos: chosen });
      toast('已合併');
      location.assign(`/p/${p.personId}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') { setSaving(false); return; }
      setError(e instanceof Error ? e.message : '合併失敗');
      setSaving(false);
    }
  }

  if (!leftId) return <div class="error">網址不正確</div>;
  if (error && !left) return <div class="error">{error}</div>;
  if (!left) return <div class="muted">載入中…</div>;

  if (!right) {
    return (
      <div>
        <h2 class="page-title">合併：{left.nameZh}（{left.yearJoined}）<span class="muted small"> ID {left.personId}</span></h2>
        <p class="text-2">選擇要與這筆合併的另一筆資料。</p>
        <input class="input" placeholder="搜尋姓名、英文名、年份或 ID" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <ul class="cand-list">
          {candidates.length === 0 && <li class="muted small" style="padding:12px 0">{q ? '沒有符合的人' : '沒有同名的人；可用上方搜尋。'}</li>}
          {candidates.map((p) => (
            <li key={p.personId}>
              <button class="btn btn-block" style="justify-content:space-between" onClick={() => { setRightId(p.personId); history.replaceState(null, '', `/p/${leftId}/merge?with=${p.personId}`); }}>
                <span>{p.nameZh}{p.nameEn ? `・${p.nameEn}` : ''}（{p.yearJoined}）</span>
                <span class="muted small">ID {p.personId}</span>
              </button>
            </li>
          ))}
        </ul>
        <p style="margin-top:20px"><a class="btn" href={`/p/${leftId}`}>取消</a></p>
      </div>
    );
  }

  const pool = [...left.photos, ...right.photos];
  const diffFields = PERSON_INPUT_FIELDS.filter((f) => JSON.stringify(left[f]) !== JSON.stringify(right[f]));
  const sameFields = PERSON_INPUT_FIELDS.filter((f) => !diffFields.includes(f));

  return (
    <div class="merge">
      <h2 class="page-title">合併兩筆資料</h2>
      <div class="merge-heads">
        <label class={`card merge-head ${keep === 'L' ? 'keep' : ''}`}>
          <input type="radio" name="keep" checked={keep === 'L'} onChange={() => setKeep('L')} /> 保留這筆的 ID
          <div class="merge-name">{left.nameZh} <span class="muted small">{left.yearJoined}</span></div>
          <div class="muted small">ID {left.personId}</div>
        </label>
        <label class={`card merge-head ${keep === 'R' ? 'keep' : ''}`}>
          <input type="radio" name="keep" checked={keep === 'R'} onChange={() => setKeep('R')} /> 保留這筆的 ID
          <div class="merge-name">{right.nameZh} <span class="muted small">{right.yearJoined}</span></div>
          <div class="muted small">ID {right.personId}</div>
        </label>
      </div>

      <div class="section-title">有差異的欄位——選要保留哪一邊</div>
      {diffFields.length === 0 && <p class="muted small">兩筆內容完全相同。</p>}
      <div class="merge-rows">
        {diffFields.map((f) => (
          <div class="merge-row" key={f}>
            <div class="merge-label">{FIELD_LABELS[f]}</div>
            <label class={`merge-opt ${pick[f] !== 'R' ? 'on' : ''}`}>
              <input type="radio" name={`f-${f}`} checked={pick[f] !== 'R'} onChange={() => setPick((p) => ({ ...p, [f]: 'L' }))} />
              <span>{show(left[f])}</span>
            </label>
            <label class={`merge-opt ${pick[f] === 'R' ? 'on' : ''}`}>
              <input type="radio" name={`f-${f}`} checked={pick[f] === 'R'} onChange={() => setPick((p) => ({ ...p, [f]: 'R' }))} />
              <span>{show(right[f])}</span>
            </label>
          </div>
        ))}
      </div>
      {sameFields.length > 0 && <p class="muted small">相同的欄位（{sameFields.map((f) => FIELD_LABELS[f]).join('、')}）自動保留。</p>}

      {pool.length > 0 && (
        <>
          <div class="section-title">照片——最多保留 {PERSON_LIMITS.photos} 張（已選 {photos.size}）</div>
          <div class="merge-photos">
            {pool.map((p) => (
              <label key={p.s3Key} class={`merge-photo ${photos.has(p.s3Key) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={photos.has(p.s3Key)}
                  onChange={(e) => {
                    const on = (e.currentTarget as HTMLInputElement).checked;
                    setPhotos((s) => { const n = new Set(s); on ? n.add(p.s3Key) : n.delete(p.s3Key); return n; });
                  }}
                />
                <img src={photoUrl(p.thumbKey)} alt="" />
              </label>
            ))}
          </div>
        </>
      )}

      <hr class="sep" />
      <label class="field">
        <span class="label">你是誰？（選填）</span>
        <input class="input" value={by} onInput={(e) => setBy((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {error && <div class="error" style="margin-bottom:12px">{error}</div>}
      <div class="row">
        <button class="btn" onClick={() => { setRightId(null); history.replaceState(null, '', `/p/${leftId}/merge`); }} disabled={saving}>換一個人</button>
        <button class="btn btn-primary" onClick={submit} disabled={saving || photos.size > PERSON_LIMITS.photos}>{saving ? '合併中…' : '合併'}</button>
      </div>
    </div>
  );
}
