import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DegreeStatus, Person, PersonInput } from '@vsp/shared';
import { emptyPersonInput, personInputSchema, personToInput, softKey } from '@vsp/shared';
import { api, ApiError, who } from '../lib/api.js';
import { toast } from '../lib/dialogs.js';

const EDIT_RE = /^\/p\/([A-Za-z0-9]{6})\/edit\/?$/;

function Seg({ value, onChange, field }: { value: DegreeStatus; onChange: (v: DegreeStatus) => void; field: string }) {
  const opts: [DegreeStatus, string][] = [['unknown', '不知道'], ['yes', '有'], ['no', '確定沒有']];
  return (
    <div class="seg" role="group" data-field={field}>
      {opts.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function YearInput({ value, onInput, placeholder, field }: { value: number | null; onInput: (v: number | null) => void; placeholder?: string; field: string }) {
  return (
    <input
      data-field={field}
      class="input"
      type="number"
      inputMode="numeric"
      min={1900}
      max={2100}
      placeholder={placeholder ?? '例如 1985'}
      value={value ?? ''}
      onInput={(e) => {
        const s = (e.currentTarget as HTMLInputElement).value;
        onInput(s === '' ? null : Number(s));
      }}
    />
  );
}

/**
 * 編輯表單（獨立頁）。只處理文字欄位，照片在人物面板內上傳。
 * 新增與編輯走同一個表單，差別只在年份是否預填。
 * 除「中文姓名」與「入實驗室年」外皆可留空，可分批分次輸入。
 */
export function EditForm() {
  const editId = useMemo(() => EDIT_RE.exec(location.pathname)?.[1] ?? null, []);
  /** 由面板的「＋ 新增」進來：載入後捲到該欄位並聚焦 */
  const focusField = useMemo(() => new URLSearchParams(location.search).get('focus'), []);
  const presetYear = useMemo(() => {
    const y = Number(new URLSearchParams(location.search).get('year'));
    return Number.isFinite(y) && y > 0 ? y : null;
  }, []);

  const [form, setForm] = useState<PersonInput>(() => ({ ...emptyPersonInput(presetYear), updatedBy: who.get() }));
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [all, setAll] = useState<Person[]>([]);
  const [dupe, setDupe] = useState<Person[] | null>(null);

  useEffect(() => {
    if (editId) {
      api.getPerson(editId)
        .then((r) => {
          if (r.person.mergedInto) location.replace(`/p/${r.person.mergedInto}/edit`);
          setForm({ ...personToInput(r.person), updatedBy: who.get() });
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      api.listPersons().then(setAll).catch(() => {});
    }
  }, [editId]);

  useEffect(() => {
    if (loading || !focusField) return;
    const el = document.querySelector<HTMLElement>(`[data-field="${focusField}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    (el.matches('input,textarea') ? el : el.querySelector<HTMLElement>('input,textarea,button'))?.focus({ preventScroll: true });
  }, [loading, focusField]);

  const set = <K extends keyof PersonInput>(k: K) => (v: PersonInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof PersonInput) => (e: Event) => set(k)((e.currentTarget as HTMLInputElement).value as never);

  /** 重複偵測 soft key：中文姓名 + 入實驗室年。命中時先問「是不是這一位？」 */
  function findDupes(): Person[] {
    if (editId) return [];
    const key = softKey(form.nameZh, form.yearJoined);
    return all.filter((p) => softKey(p.nameZh, p.yearJoined) === key);
  }

  async function save(force = false) {
    setError('');
    const parsed = personInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '欄位有誤');
      return;
    }
    if (!force) {
      const d = findDupes();
      if (d.length > 0) {
        setDupe(d);
        return;
      }
    }
    setSaving(true);
    who.set(parsed.data.updatedBy);
    try {
      const p = editId ? await api.updatePerson(editId, parsed.data) : await api.createPerson(parsed.data);
      toast('已儲存');
      location.assign(`/p/${p.personId}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') { setSaving(false); return; }
      setError(e instanceof Error ? e.message : '儲存失敗');
      setSaving(false);
    }
  }

  function cancel() {
    if (editId) location.assign(`/p/${editId}`);
    else if (history.length > 1) history.back();
    else location.assign('/');
  }

  if (loading) return <div class="muted">載入中…</div>;

  return (
    <form class="edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 class="page-title">{editId ? `編輯：${form.nameZh || '…'}` : '新增學生'}</h2>
      <p class="text-2 small" style="margin-top:-8px">只有中文姓名與入實驗室年必填，其他可以先留空，之後任何人都能補。</p>

      <label class="field">
        <span class="label">中文姓名 *</span>
        <input class="input" data-field="nameZh" required value={form.nameZh} onInput={text('nameZh')} autocomplete="off" />
      </label>
      <label class="field">
        <span class="label">入實驗室年 *</span>
        <YearInput field="yearJoined" value={form.yearJoined ?? null} onInput={(v) => set('yearJoined')(v as number)} />
        <span class="hint">第一次進實驗室的年份。這是年份清單的唯一分組依據。</span>
      </label>
      <div class="row">
        <label class="field">
          <span class="label">英文姓名</span>
          <input class="input" data-field="nameEn" value={form.nameEn} onInput={text('nameEn')} />
        </label>
        <label class="field">
          <span class="label">暱稱</span>
          <input class="input" data-field="nickname" value={form.nickname} onInput={text('nickname')} />
        </label>
      </div>

      <div class="section-title">學位</div>
      <p class="notice small">只填<strong>在本實驗室</strong>取得的學位。例如碩士在別校、博士才進本實驗室，碩士那一組就不用填（維持「不知道」或選「確定沒有」都可以）。</p>

      <div class="card" style="margin-bottom:14px">
        <label class="field" style="margin-bottom:12px">
          <span class="label">碩士學位</span>
          <Seg field="hasMaster" value={form.hasMaster} onChange={set('hasMaster')} />
        </label>
        {form.hasMaster === 'yes' && (
          <>
            <div class="row">
              <label class="field"><span class="label">碩士入學年</span><YearInput field="masterStart" value={form.masterStart} onInput={set('masterStart')} placeholder="不確定可留空" /></label>
              <label class="field"><span class="label">碩士畢業年</span><YearInput field="masterEnd" value={form.masterEnd} onInput={set('masterEnd')} placeholder="不確定可留空" /></label>
            </div>
            <label class="field" style="margin-bottom:0"><span class="label">碩士論文</span><textarea class="textarea" data-field="masterThesis" value={form.masterThesis} onInput={text('masterThesis')} placeholder="中英文皆可" /></label>
          </>
        )}
      </div>

      <div class="card">
        <label class="field" style="margin-bottom:12px">
          <span class="label">博士學位</span>
          <Seg field="hasPhd" value={form.hasPhd} onChange={set('hasPhd')} />
        </label>
        {form.hasPhd === 'yes' && (
          <>
            <div class="row">
              <label class="field"><span class="label">博士入學年</span><YearInput field="phdStart" value={form.phdStart} onInput={set('phdStart')} placeholder="不確定可留空" /></label>
              <label class="field"><span class="label">博士畢業年</span><YearInput field="phdEnd" value={form.phdEnd} onInput={set('phdEnd')} placeholder="不確定可留空" /></label>
            </div>
            <label class="field" style="margin-bottom:0"><span class="label">博士論文</span><textarea class="textarea" data-field="phdThesis" value={form.phdThesis} onInput={text('phdThesis')} placeholder="中英文皆可" /></label>
          </>
        )}
      </div>

      <div class="section-title">現況</div>
      <label class="field">
        <textarea class="textarea" data-field="currentStatus" value={form.currentStatus} onInput={text('currentStatus')} placeholder="例如：任教於某大學、在某產業服務、已退休…" />
        <span class="hint" style="color:var(--danger)">請勿輸入任何個資：電話、email、住址、身分證字號都不要填。這是公開頁面。</span>
      </label>

      <hr class="sep" />
      <label class="field">
        <span class="label">你是誰？（選填）</span>
        <input class="input" value={form.updatedBy} onInput={text('updatedBy')} placeholder="例如：1990 王小明" />
        <span class="hint">不是為了追責，是讓後來的人看修改紀錄時知道可以去問誰。</span>
      </label>

      {error && <div class="error" style="margin-bottom:12px">{error}</div>}

      <div class="row">
        <button type="button" class="btn" onClick={cancel} disabled={saving}>取消</button>
        <button type="submit" class="btn btn-primary" disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
      </div>

      {dupe && (
        <div class="dupe-backdrop" onClick={() => setDupe(null)}>
          <div class="card dupe" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 style="margin:0 0 8px">是不是這一位？</h3>
            <p class="text-2 small">已經有同名、同年入實驗室的資料：</p>
            <ul class="dupe-list">
              {dupe.map((p) => (
                <li key={p.personId}>
                  <a class="btn btn-block" href={`/p/${p.personId}/edit`}>
                    編輯既有資料：{p.nameZh}（{p.yearJoined}）<span class="muted small">ID {p.personId}</span>
                  </a>
                </li>
              ))}
            </ul>
            <div class="row" style="margin-top:12px">
              <button type="button" class="btn" onClick={() => setDupe(null)}>回去修改</button>
              <button type="button" class="btn btn-primary" onClick={() => { setDupe(null); save(true); }}>確認是另一個人，新增</button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
