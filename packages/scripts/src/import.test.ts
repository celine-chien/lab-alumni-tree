import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { decodeCsv, mapRows, parseRows, plan, DEFAULT_CONFIG } from './import-core.js';
import type { ImportConfig } from './import-core.js';
import type { Person } from '@vsp/shared';

const thesisCfg: ImportConfig = {
  ...DEFAULT_CONFIG,
  columns: { nameZh: '研究生', degree: '學位類別', thesisTitle: '論文名稱', degreeStart: '入學學年度', degreeEnd: '畢業學年度' },
  yearFormat: 'roc',
};

describe('decodeCsv', () => {
  it('Big5 自動偵測', () => {
    const csv = '研究生,學位類別,論文名稱,入學學年度,畢業學年度\n張三,碩士,某某研究,74,76\n李四,博士,另一研究,80,85\n王五,碩士,又一研究,85,87\n';
    const { text, encoding } = decodeCsv(iconv.encode(csv, 'big5'));
    expect(encoding.toLowerCase()).toContain('big5');
    expect(text).toContain('張三');
  });
  it('UTF-8 BOM', () => {
    const { text, encoding } = decodeCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2', 'utf8')]));
    expect(encoding).toContain('BOM');
    expect(text.startsWith('a,b')).toBe(true);
  });
});

describe('論文格式合併', () => {
  it('同一人碩論博論兩列 → 一筆 Person，民國年轉西元', () => {
    const rows = parseRows('研究生,學位類別,論文名稱,入學學年度,畢業學年度\n張三,碩士,碩論A,74,76\n張三,博士,博論B,77,82\n李四,博士,博論C,80,85\n');
    const { persons, problems } = mapRows(rows, thesisCfg);
    expect(problems).toEqual([]);
    expect(persons).toHaveLength(2);
    const z = persons.find((p) => p.input.nameZh === '張三')!;
    expect(z.input.hasMaster).toBe('yes');
    expect(z.input.masterThesis).toBe('碩論A');
    expect(z.input.masterStart).toBe(1985);
    expect(z.input.masterEnd).toBe(1987);
    expect(z.input.hasPhd).toBe('yes');
    expect(z.input.phdEnd).toBe(1993);
    expect(z.input.yearJoined).toBe(1985); // 取最早的學位入學年
    const l = persons.find((p) => p.input.nameZh === '李四')!;
    expect(l.input.hasMaster).toBe('unknown'); // 碩士在別校或不知道：不填
    expect(l.input.yearJoined).toBe(1991);
  });
  it('學位無法辨識時列入問題', () => {
    const rows = parseRows('研究生,學位類別,論文名稱,入學學年度,畢業學年度\n張三,學士,x,74,76\n');
    const { persons, problems } = mapRows(rows, thesisCfg);
    expect(problems[0]).toContain('無法辨識');
    expect(persons).toHaveLength(0);
  });
});

describe('plan', () => {
  const ex: Person = {
    personId: 'abcdef', nameZh: '張三', yearJoined: 1985, nameEn: '', nickname: '', hasMaster: 'yes', masterStart: 1985, masterEnd: 1987,
    masterThesis: '舊', hasPhd: 'unknown', phdStart: null, phdEnd: null, phdThesis: '', currentStatus: '', photos: [], status: 'active',
    createdAt: '', updatedAt: '', updatedBy: '',
  };
  it('有 personId → 更新；沒 id 但 soft key 命中 → 疑似重複；否則新增', () => {
    const rows = parseRows('personId,nameZh,yearJoined,masterThesis\nabcdef,張三,1985,新\n,張三,1985,\n,李四,1990,\nzzzzzz,王五,1991,\n');
    const { persons } = mapRows(rows, DEFAULT_CONFIG);
    const items = plan(persons, [ex]);
    expect(items.map((i) => i.kind)).toEqual(['update', 'suspect_duplicate', 'create', 'missing_id']);
    expect(items[0]!.changed).toEqual(['masterThesis']);
  });
  it('更新時 CSV 空白格＝不動，不會把既有的 yes/no 或論文洗掉', () => {
    const rows = parseRows('personId,nameZh,yearJoined,nameEn,hasMaster,masterThesis,hasPhd,phdThesis\nabcdef,張三,1985,,,,,\n');
    const { persons } = mapRows(rows, DEFAULT_CONFIG);
    const items = plan(persons, [{ ...ex, hasPhd: 'no' }]);
    expect(items[0]!.kind).toBe('unchanged');
  });
  it('更新時有填論文但沒標 hasX → 推導為 yes 並寫入', () => {
    const rows = parseRows('personId,nameZh,yearJoined,hasPhd,phdThesis\nabcdef,張三,1985,,博論\n');
    const { persons } = mapRows(rows, DEFAULT_CONFIG);
    const items = plan(persons, [ex]);
    expect(items[0]!.changed?.sort()).toEqual(['hasPhd', 'phdThesis']);
  });
});
