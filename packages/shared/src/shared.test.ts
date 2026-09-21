import { describe, expect, it } from 'vitest';
import { generateId, isValidId, normalizeAnswer, personInputSchema, missingFields, describeRevision } from './index.js';
import type { Person } from './index.js';

describe('id', () => {
  it('產生 6 碼且不含易混淆字元', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateId();
      expect(id).toHaveLength(6);
      expect(id).not.toMatch(/[0O1lI]/);
      expect(isValidId(id)).toBe(true);
    }
  });
});

describe('normalizeAnswer', () => {
  it('去空白、不分大小寫、全半形', () => {
    expect(normalizeAnswer(' abc ')).toBe('ABC');
    expect(normalizeAnswer('ＡＢＣ')).toBe('ABC');
    expect(normalizeAnswer('a b　c')).toBe('ABC');
    expect(normalizeAnswer('A.B.C.')).toBe('ABC');
  });
});

describe('personInputSchema', () => {
  it('年份字串轉數字、空字串轉 null', () => {
    const r = personInputSchema.parse({ nameZh: '張三', yearJoined: '1985', masterEnd: '' });
    expect(r.yearJoined).toBe(1985);
    expect(r.masterEnd).toBeNull();
    expect(r.hasMaster).toBe('unknown');
  });
  it('缺姓名報錯', () => {
    expect(() => personInputSchema.parse({ nameZh: '', yearJoined: 1985 })).toThrow();
  });
});

const base: Person = {
  personId: 'abcdef',
  nameZh: '張三',
  yearJoined: 1985,
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
  photos: [],
  status: 'active',
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

describe('missingFields', () => {
  it('unknown 是缺漏，no 不是；照片不算', () => {
    expect(missingFields(base)).toEqual(['學位']);
    expect(missingFields({ ...base, hasMaster: 'no', hasPhd: 'yes', phdEnd: 1990, phdThesis: 'x' })).toEqual([]);
  });
  it('碩博合併同一類，順序 學位 → 論文 → 畢業年', () => {
    expect(missingFields({ ...base, hasMaster: 'yes', hasPhd: 'yes' })).toEqual(['論文', '畢業年']);
    expect(missingFields({ ...base, hasMaster: 'yes', masterThesis: 'x' })).toEqual(['學位', '畢業年']);
  });
});

describe('describeRevision', () => {
  it('論文', () => {
    expect(describeRevision({ kind: 'update', changedFields: ['masterThesis'], nameZh: '張三', year: 1985 })).toBe(
      '補了 1985 年 張三 的論文',
    );
  });
});
