import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// 靜態輸出。/p/<id>、/p/<id>/edit、/p/<id>/merge、/new 由 CloudFront Function 改寫到對應的 index.html
// （本機 dev 由 vite 中介層處理，見下）。
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  build: { format: 'directory' },
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:8787',
        '/photos': 'http://localhost:8787',
      },
    },
    plugins: [
      {
        name: 'vsp-rewrite',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const url = req.url ?? '';
            if (/^\/p\/[A-Za-z0-9]{6}\/edit(\?|$)/.test(url) || /^\/new(\?|$)/.test(url)) req.url = '/edit/' + (url.includes('?') ? url.slice(url.indexOf('?')) : '');
            else if (/^\/p\/[A-Za-z0-9]{6}\/merge(\?|$)/.test(url)) req.url = '/merge/' + (url.includes('?') ? url.slice(url.indexOf('?')) : '');
            else if (/^\/p\/[A-Za-z0-9]{6}(\?|$)/.test(url)) req.url = '/';
            next();
          });
        },
      },
    ],
  },
});
