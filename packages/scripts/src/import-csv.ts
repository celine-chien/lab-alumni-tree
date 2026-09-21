import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIELD_LABELS, generateUniqueId } from '@vsp/shared';
import type { Person, Revision } from '@vsp/shared';
import { getStore, parseArgs } from './common.js';
import { backup } from './backup.js';
import { decodeCsv, DEFAULT_CONFIG, mapRows, parseRows, plan } from './import-core.js';
import type { ImportConfig } from './import-core.js';

/**
 * CSV 匯入 script（只由專案擁有者執行，網站上不提供匯入介面）。
 *
 *   pnpm import --file data.csv [--config import.config.json] [--store file|dynamo] [--commit] [--allow-duplicates]
 *
 * - dry-run 為預設：只印出新增 N / 更新 M / 疑似重複 K 與逐筆差異，加 --commit 才寫入
 * - CSV 有 personId → 更新；空白 → 新增並產生 6 碼 id
 * - 無 personId 時以「中文姓名＋入實驗室年」比對，命中者列為疑似重複、不寫入（--allow-duplicates 才會新增）
 * - commit 前自動備份整張表到 backups/
 */
const { flags } = parseArgs(process.argv.slice(2));
const file = flags.file ? String(flags.file) : null;
if (!file) {
  console.error('用法：pnpm import --file data.csv [--config import.config.json] [--store file|dynamo] [--commit]');
  process.exit(1);
}
const cfg: ImportConfig = flags.config
  ? { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(String(flags.config), 'utf8')) as ImportConfig) }
  : DEFAULT_CONFIG;
if (!flags.config && existsSync(resolve('import.config.json'))) {
  Object.assign(cfg, JSON.parse(readFileSync(resolve('import.config.json'), 'utf8')));
  console.log('使用 ./import.config.json');
}

const buf = readFileSync(file);
const { text, encoding } = decodeCsv(buf);
console.log(`檔案：${file}（編碼：${encoding}，${buf.length} bytes）`);
const rows = parseRows(text, cfg.skipRows ?? 0);
console.log(`共 ${rows.length} 列，欄位：${Object.keys(rows[0] ?? {}).join(' | ')}`);
// 匯出檔第二列是中文說明列：自動略過
if (rows[0] && Object.values(rows[0]).some((v) => v === FIELD_LABELS.nameZh)) {
  rows.shift();
  console.log('偵測到中文欄名說明列，已略過');
}

const { persons, problems } = mapRows(rows, cfg);
const { store, label } = getStore(flags);
const existing = await store.listPersons({ includeHidden: true });
const items = plan(persons, existing);

const count = (k: string) => items.filter((i) => i.kind === k).length;
console.log('\n================ 結果（dry-run）================');
console.log(`目標：${label}`);
console.log(`新增 ${count('create')} 筆、更新 ${count('update')} 筆、無變更 ${count('unchanged')} 筆、疑似重複 ${count('suspect_duplicate')} 筆、personId 不存在 ${count('missing_id')} 筆`);

if (problems.length) {
  console.log('\n--- 需要注意 ---');
  for (const p of problems) console.log('  ! ' + p);
}

const isThesis = !!cfg.columns.degree;
if (isThesis) {
  console.log('\n--- 論文列合併結果（請逐筆檢查）---');
  for (const it of items) {
    const p = it.imported;
    console.log(`  ${p.input.nameZh}（${p.input.yearJoined}）碩:${p.input.hasMaster} 博:${p.input.hasPhd}  ← 列 ${p.sourceRows.join(',')}`);
    for (const n of p.notes) console.log('      ' + n);
  }
}

console.log('\n--- 逐筆 ---');
for (const it of items) {
  const p = it.imported.input;
  const head = `${p.nameZh}（${p.yearJoined}）`;
  switch (it.kind) {
    case 'create':
      console.log(`  + 新增 ${head}`);
      break;
    case 'update':
      console.log(`  ~ 更新 ${head} [${it.existing!.personId}]`);
      for (const f of it.changed!) console.log(`      ${FIELD_LABELS[f] ?? f}: ${JSON.stringify((it.existing as never as Record<string, unknown>)[f] ?? '')} → ${JSON.stringify((p as never as Record<string, unknown>)[f] ?? '')}`);
      break;
    case 'unchanged':
      console.log(`  = 無變更 ${head} [${it.existing!.personId}]`);
      break;
    case 'suspect_duplicate':
      console.log(`  ? 疑似重複 ${head}，既有：${it.candidates!.map((c) => `[${c.personId}]`).join(' ')}  → 不寫入。要更新請在 CSV 填 personId；確定是不同人請加 --allow-duplicates`);
      break;
    case 'missing_id':
      console.log(`  ! ${head} 的 personId「${it.imported.personId}」不存在 → 略過（請確認是否打錯）`);
      break;
  }
}

if (!flags.commit) {
  console.log('\n以上為 dry-run，未寫入任何資料。確認無誤請加 --commit。');
  process.exit(0);
}

const toWrite = items.filter((i) => i.kind === 'create' || i.kind === 'update' || (i.kind === 'suspect_duplicate' && flags['allow-duplicates']));
if (toWrite.length === 0) {
  console.log('\n沒有需要寫入的資料。');
  process.exit(0);
}

const backupFile = await backup(store, 'pre-import');
console.log(`\n已備份 → ${backupFile}`);

const ts = new Date().toISOString();
const by = 'csv-import';
let n = 0;
for (const it of toWrite) {
  const inp = it.imported.input;
  if (it.kind === 'update') {
    const before = it.existing!;
    const after: Person = { ...before, ...inp, yearJoined: inp.yearJoined as number, updatedAt: ts, updatedBy: by };
    await store.putPerson(after);
    await store.putRevision(rev('update', before, after, it.changed!));
  } else {
    const personId = await generateUniqueId((id) => store.idExists(id));
    const person: Person = { personId, ...inp, yearJoined: inp.yearJoined as number, photos: [], status: 'active', createdAt: ts, updatedAt: ts, updatedBy: by };
    await store.putPerson(person);
    await store.putRevision(rev('create', null, person, []));
  }
  n++;
  if (n % 25 === 0) console.log(`  已寫入 ${n}/${toWrite.length}`);
}
console.log(`完成：寫入 ${n} 筆。`);

function rev(kind: 'create' | 'update', before: Person | null, after: Person, changed: string[]): Revision {
  const t = new Date().toISOString();
  return {
    revId: `${t}#${Math.random().toString(36).slice(2, 6)}`,
    target: 'person',
    targetId: after.personId,
    ts: t,
    kind,
    before,
    changedFields: changed,
    nameZh: after.nameZh,
    year: after.yearJoined,
    by,
  };
}
