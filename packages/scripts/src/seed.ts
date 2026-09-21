import { FileStore } from '@vsp/api/store';
import { generateId } from '@vsp/shared';
import type { Person } from '@vsp/shared';
import { resolve } from 'node:path';
import { ROOT } from './common.js';

/** 本機開發用假資料（不會動到正式環境） */
const store = new FileStore(resolve(ROOT, '.data/db.json'));
const names = ['王小明', '李大華', '張美玲', '陳志強', '林雅婷', '黃建宏', '吳淑芬', '劉俊傑', '蔡佩珊', '楊宗翰', '許家豪', '鄭雅文', '謝明哲', '郭怡君', '洪志偉', '曾雅琪', '周建志', '賴淑惠', '徐文龍', '葉美慧'];
const years = [1978, 1980, 1981, 1985, 1985, 1985, 1986, 1990, 1990, 1992, 1995, 1995, 1995, 1995, 1998, 2000, 2001, 2003, 2005, 2006];
const ts = new Date().toISOString();
let i = 0;
for (const name of names) {
  const y = years[i]!;
  const r = i % 4;
  const p: Person = {
    personId: generateId(),
    nameZh: name,
    yearJoined: y,
    nameEn: i % 3 === 0 ? `Student ${i}` : '',
    nickname: '',
    hasMaster: r === 0 ? 'yes' : r === 1 ? 'yes' : r === 2 ? 'no' : 'unknown',
    masterStart: r <= 1 ? y : null,
    masterEnd: r === 0 ? y + 2 : null,
    masterThesis: r === 0 ? `關於某某之研究 ${i}` : '',
    hasPhd: r === 2 || r === 1 ? 'yes' : r === 0 ? 'no' : 'unknown',
    phdStart: r === 2 ? y : r === 1 ? y + 2 : null,
    phdEnd: r === 2 ? y + 5 : null,
    phdThesis: r === 2 ? `A Study on Something ${i}` : '',
    currentStatus: i % 5 === 0 ? '任教於某大學' : '',
    photos: [],
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
    updatedBy: '',
  };
  await store.putPerson(p);
  await store.putRevision({ revId: `${ts}#${i.toString().padStart(4, '0')}`, target: 'person', targetId: p.personId, ts, kind: 'create', before: null, changedFields: [], nameZh: p.nameZh, year: y, by: 'seed' });
  i++;
}
console.log(`已寫入 ${names.length} 筆假資料 → .data/db.json`);
