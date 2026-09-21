import { writeFileSync } from 'node:fs';
import { stringify } from 'csv-stringify/sync';
import { FIELD_LABELS, PERSON_INPUT_FIELDS } from '@vsp/shared';
import { getStore, parseArgs } from './common.js';

/**
 * 匯出 CSV。**必含 personId 欄位**，否則「匯出 → Excel 修改 → 匯回」會變成整批複製而非更新。
 * 輸出 UTF-8 with BOM，Excel 直接開不會亂碼。
 *   pnpm export --out persons.csv [--store dynamo]
 */
const { flags } = parseArgs(process.argv.slice(2));
const { store, label } = getStore(flags);
const out = String(flags.out ?? 'persons.csv');
const persons = (await store.listPersons()).sort((a, b) => a.yearJoined - b.yearJoined || a.nameZh.localeCompare(b.nameZh, 'zh-Hant'));

const header = ['personId', ...PERSON_INPUT_FIELDS, 'photoCount', 'updatedAt', 'updatedBy'];
const rows = persons.map((p) => [
  p.personId,
  ...PERSON_INPUT_FIELDS.map((f) => p[f] ?? ''),
  p.photos.length,
  p.updatedAt,
  p.updatedBy,
]);
const labelRow = header.map((h) => FIELD_LABELS[h] ?? h);
const csv = stringify([header, labelRow, ...rows]);
writeFileSync(out, '﻿' + csv);
console.log(`已匯出 ${persons.length} 筆（來源：${label}）→ ${out}`);
console.log('第二列是中文欄名說明，匯回時 script 會自動略過。');
