import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Store } from '@vsp/api/store';
import { getStore, parseArgs, ROOT } from './common.js';

/** 整張表 dump 成 JSON 存到 backups/。三百筆只需一秒，救回來的卻是全部。 */
export async function backup(store: Store, tag = 'manual'): Promise<string> {
  const data = await store.dumpAll();
  const dir = resolve(ROOT, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

if (process.argv[1]?.endsWith('backup.ts')) {
  const { flags } = parseArgs(process.argv.slice(2));
  const { store, label } = getStore(flags);
  const file = await backup(store);
  console.log(`已備份 ${label} → ${file}`);
}
