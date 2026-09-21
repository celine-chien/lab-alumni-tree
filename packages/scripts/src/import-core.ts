import chardet from 'chardet';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import type { DegreeStatus, Person, PersonInput } from '@vsp/shared';
import { changedFields, emptyPersonInput, isValidId, PERSON_INPUT_FIELDS, softKey } from '@vsp/shared';

/**
 * CSV 匯入的欄位對應設定。實際欄位名要看到真實 CSV 才能定案，因此放設定檔，不寫死。
 *
 * 兩種來源格式：
 * 1. 「一列＝一個人」：直接對應 Person 欄位（columns.nameZh、columns.masterEnd…）。
 * 2. 「一列＝一本論文」（學校論文系統）：有 columns.degree / thesisTitle / degreeStart / degreeEnd，
 *    同一人的碩論與博論是兩列。script 先依「姓名（＋入實驗室年）」合併為一筆 Person，
 *    碩論填碩士欄位組、博論填博士欄位組。**這是最容易出錯的一步，dry-run 會印出合併結果。**
 */
export interface ImportConfig {
  columns: Partial<Record<keyof PersonInput | 'personId' | 'degree' | 'thesisTitle' | 'degreeStart' | 'degreeEnd', string>>;
  /** degree 欄位裡代表碩士／博士的值（不分大小寫、去空白） */
  degreeValues?: { master: string[]; phd: string[] };
  /** 年份格式：ad 西元（預設）；roc 民國，會 +1911 */
  yearFormat?: 'ad' | 'roc';
  /** 沒有 yearJoined 欄位時，用最早的學位入學年當入實驗室年 */
  yearJoinedFromDegreeStart?: boolean;
  /** 跳過前幾列（例如匯出檔第二列是中文說明） */
  skipRows?: number;
}

export const DEFAULT_CONFIG: ImportConfig = {
  columns: {
    personId: 'personId',
    nameZh: 'nameZh',
    yearJoined: 'yearJoined',
    nameEn: 'nameEn',
    nickname: 'nickname',
    hasMaster: 'hasMaster',
    masterStart: 'masterStart',
    masterEnd: 'masterEnd',
    masterThesis: 'masterThesis',
    hasPhd: 'hasPhd',
    phdStart: 'phdStart',
    phdEnd: 'phdEnd',
    phdThesis: 'phdThesis',
    currentStatus: 'currentStatus',
  },
  degreeValues: { master: ['碩士', '碩', 'M', 'MS', 'Master', '碩士論文'], phd: ['博士', '博', 'D', 'PhD', 'Ph.D.', 'Doctor', '博士論文'] },
  yearFormat: 'ad',
  yearJoinedFromDegreeStart: true,
};

/** 編碼偵測：BOM → UTF-8；否則 chardet（學校系統很可能是 Big5）。 */
export function decodeCsv(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8 (BOM)' };
  const detected = chardet.detect(buf) ?? 'UTF-8';
  const enc = /big5|gb|windows-125|iso-8859/i.test(detected) ? detected : 'UTF-8';
  const encoding = /big5/i.test(enc) ? 'big5' : enc;
  return { text: iconv.decode(buf, encoding), encoding };
}

export function parseRows(text: string, skipRows = 0): Record<string, string>[] {
  const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true }) as Record<string, string>[];
  return rows.slice(skipRows);
}

function toYear(v: string | undefined, fmt: ImportConfig['yearFormat']): number | null {
  if (!v) return null;
  const m = /\d{2,4}/.exec(v.replace(/[^\d]/g, ' '));
  if (!m) return null;
  let n = Number(m[0]);
  if (fmt === 'roc' || (n > 0 && n < 200)) n += 1911; // 民國年（兩三位數）一律視為民國
  return n >= 1900 && n <= 2100 ? n : null;
}

function toDegree(v: string | undefined): DegreeStatus {
  const s = (v ?? '').trim().toLowerCase();
  if (['yes', 'y', '有', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', '無', '沒有', 'false', '0'].includes(s)) return 'no';
  return 'unknown';
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export interface ImportedPerson {
  personId: string | null;
  input: PersonInput;
  /** 來源列號（1-based，含標題列） */
  sourceRows: number[];
  /** 論文列合併時的說明 */
  notes: string[];
  /** 一列一人格式：CSV 裡實際存在的欄位；更新時只動這些 */
  presentFields?: string[];
}

/** 把 CSV 列轉成 Person 輸入。論文格式時依姓名合併多列。 */
export function mapRows(rows: Record<string, string>[], cfg: ImportConfig): { persons: ImportedPerson[]; problems: string[] } {
  const c = cfg.columns;
  const problems: string[] = [];
  const get = (row: Record<string, string>, key: keyof typeof c) => {
    const col = c[key];
    return col ? row[col]?.trim() : undefined;
  };
  const isThesisFormat = !!c.degree && !!c.thesisTitle;
  const persons = new Map<string, ImportedPerson>();
  const dv = cfg.degreeValues ?? DEFAULT_CONFIG.degreeValues!;

  rows.forEach((row, i) => {
    const line = i + 2;
    const nameZh = get(row, 'nameZh');
    if (!nameZh) {
      problems.push(`第 ${line} 列：沒有中文姓名，略過`);
      return;
    }
    const personId = get(row, 'personId') || null;
    if (personId && !isValidId(personId)) problems.push(`第 ${line} 列：personId「${personId}」格式不對，會當成新增`);
    const yearJoined = toYear(get(row, 'yearJoined'), cfg.yearFormat);

    const key = personId && isValidId(personId) ? `id:${personId}` : softKey(nameZh, isThesisFormat ? null : yearJoined) + (isThesisFormat ? '' : `#${i}`);
    let p = persons.get(key);
    if (!p) {
      p = { personId: personId && isValidId(personId) ? personId : null, input: emptyPersonInput(yearJoined), sourceRows: [], notes: [] };
      p.input.nameZh = nameZh;
      persons.set(key, p);
    }
    p.sourceRows.push(line);
    const inp = p.input;
    if (yearJoined && !inp.yearJoined) inp.yearJoined = yearJoined;
    for (const f of ['nameEn', 'nickname', 'currentStatus'] as const) {
      const v = get(row, f);
      if (v && !inp[f]) inp[f] = v;
    }

    if (isThesisFormat) {
      const degRaw = get(row, 'degree') ?? '';
      const d = norm(degRaw);
      const which = dv.master.some((x) => norm(x) === d) ? 'master' : dv.phd.some((x) => norm(x) === d) ? 'phd' : null;
      if (!which) {
        problems.push(`第 ${line} 列（${nameZh}）：學位「${degRaw}」無法辨識，這列的論文沒有填入`);
        return;
      }
      const title = get(row, 'thesisTitle') ?? '';
      const start = toYear(get(row, 'degreeStart'), cfg.yearFormat);
      const end = toYear(get(row, 'degreeEnd'), cfg.yearFormat);
      if (which === 'master') {
        if (inp.hasMaster === 'yes') problems.push(`第 ${line} 列（${nameZh}）：已有一筆碩士論文，這列會覆蓋前一列。同名不同人？`);
        inp.hasMaster = 'yes';
        inp.masterThesis = title;
        inp.masterStart = start;
        inp.masterEnd = end;
      } else {
        if (inp.hasPhd === 'yes') problems.push(`第 ${line} 列（${nameZh}）：已有一筆博士論文，這列會覆蓋前一列。同名不同人？`);
        inp.hasPhd = 'yes';
        inp.phdThesis = title;
        inp.phdStart = start;
        inp.phdEnd = end;
      }
      p.notes.push(`第 ${line} 列 → ${which === 'master' ? '碩士' : '博士'}${start ?? '?'}–${end ?? '?'}「${title.slice(0, 30)}」`);
    } else {
      // 只覆寫 CSV 裡真的有填值的格子；沒對應到、檔案裡沒有這欄、或格子空白的欄位一律維持原值。
      // 空白＝「不動」而非「清空」：匯出→Excel 改幾格→匯回時，才不會把別人在網站上填的東西洗掉。
      const has = (k: keyof typeof c) => !!get(row, k);
      if (has('hasMaster')) inp.hasMaster = toDegree(get(row, 'hasMaster'));
      if (has('hasPhd')) inp.hasPhd = toDegree(get(row, 'hasPhd'));
      if (has('masterStart')) inp.masterStart = toYear(get(row, 'masterStart'), cfg.yearFormat);
      if (has('masterEnd')) inp.masterEnd = toYear(get(row, 'masterEnd'), cfg.yearFormat);
      if (has('masterThesis')) inp.masterThesis = get(row, 'masterThesis') ?? '';
      if (has('phdStart')) inp.phdStart = toYear(get(row, 'phdStart'), cfg.yearFormat);
      if (has('phdEnd')) inp.phdEnd = toYear(get(row, 'phdEnd'), cfg.yearFormat);
      if (has('phdThesis')) inp.phdThesis = get(row, 'phdThesis') ?? '';
      p.presentFields = Object.keys(c).filter((k) => has(k as keyof typeof c));
      // 有論文或年份但沒標 hasX → 視為 yes（推導出的值也要進 presentFields 才會寫入）
      if (inp.hasMaster === 'unknown' && (inp.masterThesis || inp.masterEnd)) { inp.hasMaster = 'yes'; p.presentFields.push('hasMaster'); }
      if (inp.hasPhd === 'unknown' && (inp.phdThesis || inp.phdEnd)) { inp.hasPhd = 'yes'; p.presentFields.push('hasPhd'); }
    }
  });

  for (const p of persons.values()) {
    if (!p.input.yearJoined && cfg.yearJoinedFromDegreeStart !== false) {
      const ys = [p.input.masterStart, p.input.phdStart].filter((y): y is number => y !== null);
      if (ys.length) {
        p.input.yearJoined = Math.min(...ys);
        p.notes.push(`入實驗室年取自最早的學位入學年 ${p.input.yearJoined}`);
      }
    }
    if (!p.input.yearJoined) problems.push(`${p.input.nameZh}（列 ${p.sourceRows.join(',')}）：沒有入實驗室年，無法匯入`);
  }

  return { persons: [...persons.values()].filter((p) => !!p.input.yearJoined), problems };
}

export interface PlanItem {
  kind: 'create' | 'update' | 'unchanged' | 'suspect_duplicate' | 'missing_id';
  imported: ImportedPerson;
  existing?: Person;
  candidates?: Person[];
  changed?: string[];
}

/** 決定每筆是新增／更新／疑似重複。personId 決定新增或更新；沒 id 時用 soft key 找疑似重複，不自動合併。 */
export function plan(imported: ImportedPerson[], existing: Person[]): PlanItem[] {
  const byId = new Map(existing.map((p) => [p.personId, p]));
  const byKey = new Map<string, Person[]>();
  for (const p of existing) {
    const k = softKey(p.nameZh, p.yearJoined);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  return imported.map((imp) => {
    if (imp.personId) {
      const ex = byId.get(imp.personId);
      if (!ex) return { kind: 'missing_id', imported: imp };
      const patch: Partial<Person> = imp.presentFields
        ? Object.fromEntries(Object.entries(imp.input).filter(([k]) => imp.presentFields!.includes(k)))
        : { ...imp.input };
      // 論文格式：unknown 代表「這份 CSV 沒提到」，不要把既有的 yes/no 洗掉
      if (!imp.presentFields) {
        if (imp.input.hasMaster === 'unknown') { delete patch.hasMaster; delete patch.masterStart; delete patch.masterEnd; delete patch.masterThesis; }
        if (imp.input.hasPhd === 'unknown') { delete patch.hasPhd; delete patch.phdStart; delete patch.phdEnd; delete patch.phdThesis; }
      }
      for (const k of ['nameEn', 'nickname', 'currentStatus'] as const) if (patch[k] === '') delete patch[k];
      delete (patch as Record<string, unknown>).updatedBy;
      const merged: Person = { ...ex, ...patch, yearJoined: (patch.yearJoined ?? ex.yearJoined) as number };
      imp.input = { ...imp.input, ...(Object.fromEntries(Object.entries(merged).filter(([k]) => k in imp.input)) as typeof imp.input) };
      const changed = changedFields(ex, merged).filter((f) => PERSON_INPUT_FIELDS.includes(f as never));
      return changed.length ? { kind: 'update', imported: imp, existing: ex, changed } : { kind: 'unchanged', imported: imp, existing: ex };
    }
    const cands = byKey.get(softKey(imp.input.nameZh, imp.input.yearJoined)) ?? [];
    if (cands.length) return { kind: 'suspect_duplicate', imported: imp, candidates: cands };
    return { kind: 'create', imported: imp };
  });
}
