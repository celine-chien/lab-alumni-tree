import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app.js';
import { FileStore } from './store/file.js';
import { LocalBlobs } from './blobs/local.js';
import { envSecrets } from './config.js';

/**
 * 本機開發伺服器：port 8787。
 * - 資料：.data/db.json
 * - 照片：.data/photos/，GET /photos/<key> 讀取
 * Astro dev server 會把 /api 與 /photos proxy 到這裡。
 */
const port = Number(process.env.PORT ?? 8787);
const dataDir = resolve(process.cwd(), '../../.data');
const photoDir = join(dataDir, 'photos');
const blobs = new LocalBlobs(photoDir);

const api = createApp({ store: new FileStore(join(dataDir, 'db.json')), blobs, secrets: envSecrets() });

const dev = new Hono();
dev.get('/photos/*', (c) => {
  const key = c.req.path.replace('/photos/', '');
  const file = join(photoDir, key);
  if (key.includes('..') || !existsSync(file)) return c.text('not found', 404);
  const type = key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return c.body(readFileSync(file), 200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
});
dev.route('/', api);

serve({ fetch: dev.fetch, port }, () => {
  console.log(`API dev server → http://localhost:${port}  (data: ${dataDir})`);
});
