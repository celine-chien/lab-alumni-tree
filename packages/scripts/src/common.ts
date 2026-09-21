import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DynamoStore, FileStore } from '@vsp/api/store';
import type { Store } from '@vsp/api/store';

export const ROOT = resolve(import.meta.dirname, '../../..');

export function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k!] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags[k!] = argv[++i]!;
      else flags[k!] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

/** 讀 CDK 部署輸出（packages/infra/cdk-outputs.json） */
export function cdkOutputs(): Record<string, string> {
  const f = resolve(ROOT, 'packages/infra/cdk-outputs.json');
  if (!existsSync(f)) return {};
  const j = JSON.parse(readFileSync(f, 'utf8')) as Record<string, Record<string, string>>;
  return Object.values(j)[0] ?? {};
}

/**
 * --store file（預設）→ .data/db.json（本機開發資料）
 * --store dynamo [--table 名稱] → 正式環境（table 預設讀 cdk-outputs.json）
 */
export function getStore(flags: Record<string, string | boolean>): { store: Store; label: string } {
  const kind = String(flags.store ?? 'file');
  if (kind === 'dynamo') {
    const table = String(flags.table ?? cdkOutputs().TableName ?? '');
    if (!table) throw new Error('找不到 table 名稱：請加 --table 或先 deploy 產生 cdk-outputs.json');
    return { store: new DynamoStore(table), label: `DynamoDB ${table}` };
  }
  const path = resolve(ROOT, '.data/db.json');
  return { store: new FileStore(path), label: path };
}
