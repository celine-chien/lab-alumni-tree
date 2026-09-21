import type { DegreeStatus, Person, PersonInput, Revision } from './index.js';

/** 中文欄位名稱，供表單、修改紀錄、最近更新共用。 */
export const FIELD_LABELS: Record<string, string> = {
  nameZh: '中文姓名',
  yearJoined: '入實驗室年',
  nameEn: '英文姓名',
  nickname: '暱稱',
  hasMaster: '碩士學位',
  masterStart: '碩士入學年',
  masterEnd: '碩士畢業年',
  masterThesis: '碩士論文',
  hasPhd: '博士學位',
  phdStart: '博士入學年',
  phdEnd: '博士畢業年',
  phdThesis: '博士論文',
  currentStatus: '現況',
  photos: '照片',
  status: '狀態',
};

export const PERSON_INPUT_FIELDS = [
  'nameZh',
  'yearJoined',
  'nameEn',
  'nickname',
  'hasMaster',
  'masterStart',
  'masterEnd',
  'masterThesis',
  'hasPhd',
  'phdStart',
  'phdEnd',
  'phdThesis',
  'currentStatus',
] as const satisfies readonly (keyof PersonInput)[];

export function emptyPersonInput(yearJoined: number | null = null): PersonInput {
  return {
    nameZh: '',
    yearJoined: yearJoined as number,
    nameEn: '',
    nickname: '',
    hasMaster: 'unknown',
    masterStart: null,
    masterEnd: null,
    masterThesis: '',
    hasPhd: 'unknown',
    phdStart: null,
    phdEnd: null,
    phdThesis: '',
    currentStatus: '',
    updatedBy: '',
  };
}

export function personToInput(p: Person): PersonInput {
  return {
    nameZh: p.nameZh,
    yearJoined: p.yearJoined,
    nameEn: p.nameEn,
    nickname: p.nickname,
    hasMaster: p.hasMaster,
    masterStart: p.masterStart,
    masterEnd: p.masterEnd,
    masterThesis: p.masterThesis,
    hasPhd: p.hasPhd,
    phdStart: p.phdStart,
    phdEnd: p.phdEnd,
    phdThesis: p.phdThesis,
    currentStatus: p.currentStatus,
    updatedBy: p.updatedBy,
  };
}

/** 比較兩個 Person（或輸入），回傳有差異的欄位名稱。 */
export function changedFields(a: Partial<Person> | null, b: Partial<Person>): string[] {
  if (!a) return ['*'];
  const out: string[] = [];
  for (const f of [...PERSON_INPUT_FIELDS, 'photos', 'status'] as const) {
    const av = a[f];
    const bv = b[f];
    if (JSON.stringify(av ?? null) !== JSON.stringify(bv ?? null)) out.push(f);
  }
  return out;
}

/**
 * 「缺漏要看得見」：回傳這個人尚待補的類別，依 學位 → 論文 → 畢業年 排序。
 * - 寫欄位名稱不寫數字：校友要看到「缺論文」才知道自己幫不幫得上忙
 * - 碩博合併成同一類（碩論、博論都缺只寫一次「論文」）
 * - 照片不列入：照片的缺漏由卡片右側的虛線框表達
 * - 學位 no 是確定資訊，不算缺漏；全部補齊回傳空陣列
 */
export function missingFields(p: Person): string[] {
  const out: string[] = [];
  if (p.hasMaster === 'unknown' || p.hasPhd === 'unknown') out.push('學位');
  const yes = (['master', 'phd'] as const).filter((d) => (d === 'master' ? p.hasMaster : p.hasPhd) === 'yes');
  if (yes.some((d) => !(d === 'master' ? p.masterThesis : p.phdThesis))) out.push('論文');
  if (yes.some((d) => (d === 'master' ? p.masterEnd : p.phdEnd) == null)) out.push('畢業年');
  return out;
}

export function degreeLabel(s: DegreeStatus, name: '碩士' | '博士'): string {
  if (s === 'yes') return name;
  if (s === 'no') return `無${name}`;
  return `${name}待補`;
}

/** 「最近有人補了 1985 年張三的論文」 */
export function describeRevision(r: Pick<Revision, 'kind' | 'changedFields' | 'nameZh' | 'year'>): string {
  const who = `${r.year} 年${r.nameZh ? ` ${r.nameZh}` : ''}`;
  switch (r.kind) {
    case 'create':
      return `新增了 ${who}`;
    case 'restore':
      return `還原了 ${who} 的資料`;
    case 'merge':
      return `合併了 ${who} 的重複資料`;
    case 'merged_away':
      return `${who} 被合併到另一筆`;
    case 'photo_add':
      return `為 ${who} 加了一張照片`;
    case 'photo_delete':
      return `刪了 ${who} 的一張照片`;
    case 'group_photo_add':
      return `為 ${r.year} 年加了一張合照`;
    case 'group_photo_delete':
      return `刪了 ${r.year} 年的一張合照`;
    case 'admin_hide':
      return `管理者隱藏了 ${who} 的內容`;
    case 'admin_unhide':
      return `管理者恢復了 ${who} 的內容`;
    case 'update': {
      const fields = r.changedFields.filter((f) => f !== 'updatedBy');
      if (fields.length === 0) return `更新了 ${who}`;
      const thesis = fields.some((f) => f.endsWith('Thesis'));
      if (thesis && fields.length <= 2) return `補了 ${who} 的論文`;
      const labels = fields
        .slice(0, 2)
        .map((f) => FIELD_LABELS[f] ?? f)
        .join('、');
      return `補了 ${who} 的${labels}${fields.length > 2 ? '等' : ''}`;
    }
  }
}

/** 重複偵測 soft key：中文姓名 + 入實驗室年 */
export function softKey(nameZh: string, yearJoined: number | null | undefined): string {
  return `${nameZh.replace(/\s+/g, '')}#${yearJoined ?? ''}`;
}
