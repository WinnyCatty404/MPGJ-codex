// BB 密评工具 - 前端静态服务器（仅用 Node 内置模块，无外部依赖）
// 启动：node bb-serve-frontend.js --dist <前端dist目录> --port <端口> --api <后端地址>
// 作用：托管构建后的前端静态文件，并把 /api 请求代理到后端。
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const distDir = path.resolve(getArg('--dist', 'frontend/dist'));
const listenPort = parseInt(getArg('--port', '5173'), 10);
const apiTarget = getArg('--api', 'http://127.0.0.1:3100');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(distDir, pathname);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退：无扩展名的路由返回 index.html
      if (!path.extname(pathname)) {
        fs.readFile(path.join(distDir, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not Found'); }
          else { res.writeHead(200, { 'Content-Type': mime['.html'] }); res.end(d2); }
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyApi(req, res) {
  const options = url.parse(apiTarget + req.url);
  options.method = req.method;
  options.headers = req.headers;
  const proxy = http.request(options, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  proxy.on('error', (e) => { res.writeHead(502); res.end('Bad Gateway: ' + e.message); });
  req.pipe(proxy);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) { proxyApi(req, res); }
  else { serveStatic(req, res); }
});
server.listen(listenPort, '127.0.0.1', () => {
  console.log('BB 密评前端已启动：http://localhost:' + listenPort + '  (API -> ' + apiTarget + ')');
});
