// CloudFront Function（viewer request）：把前端路由改寫到對應的靜態 HTML。
//   /p/xxxxxx        → /index.html（首頁自行解析網址、開啟人物面板）
//   /p/xxxxxx/edit   → /edit/index.html
//   /new             → /edit/index.html
//   /p/xxxxxx/merge  → /merge/index.html
//   /foo/            → /foo/index.html
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (/^\/p\/[A-Za-z0-9]{6}\/edit\/?$/.test(uri) || /^\/new\/?$/.test(uri)) req.uri = '/edit/index.html';
  else if (/^\/p\/[A-Za-z0-9]{6}\/merge\/?$/.test(uri)) req.uri = '/merge/index.html';
  else if (/^\/p\/[A-Za-z0-9]{6}\/?$/.test(uri)) req.uri = '/index.html';
  else if (uri.endsWith('/')) req.uri = uri + 'index.html';
  else if (!uri.includes('.')) req.uri = uri + '/index.html';
  return req;
}
