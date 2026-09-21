import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Blobs } from './types.js';

/** 本機開發：寫到資料夾，dev server 以 GET /photos/<key> 提供。 */
export class LocalBlobs implements Blobs {
  constructor(public readonly dir: string) {}
  async put(key: string, body: Uint8Array) {
    const file = join(this.dir, key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  async exists(key: string) {
    return existsSync(join(this.dir, key));
  }
}
