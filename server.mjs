import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(appDirectory, 'dist');
const appId = 'h12-821-practice';
const rootId = createHash('sha256').update(path.resolve(appDirectory).toLowerCase(), 'utf8').digest('hex');
const args = process.argv.slice(2);
let port = 8210;
let bindHost = '127.0.0.1';
for (let index = 0; index < args.length; index += 2) {
  const option = args[index];
  const value = args[index + 1];
  if (!value || !['--port', '--host'].includes(option)) {
    console.error('Usage: node server.mjs [--host 127.0.0.1] [--port 8210]');
    process.exit(1);
  }
  if (option === '--port') {
    if (!/^\d+$/.test(value)) {
      console.error('Port must be an integer from 1 to 65535.');
      process.exit(1);
    }
    port = Number(value);
  } else {
    bindHost = value;
  }
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port must be an integer from 1 to 65535.');
  process.exit(1);
}
if (!/^[a-zA-Z0-9.:%-]+$/.test(bindHost)) {
  console.error('Host contains unsupported characters.');
  process.exit(1);
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
]);

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function sendText(response, status, message, isHead = false) {
  const body = Buffer.from(message, 'utf8');
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(isHead ? undefined : body);
}

let realDistDirectory;
try {
  realDistDirectory = await realpath(distDirectory);
  const indexPath = await realpath(path.join(distDirectory, 'index.html'));
  if (!isWithin(realDistDirectory, indexPath) || !(await stat(indexPath)).isFile()) {
    throw new Error('Invalid dist/index.html');
  }
} catch {
  console.error('Built app missing: run npm run build to create dist/index.html.');
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const isHead = request.method === 'HEAD';
  if (request.method !== 'GET' && !isHead) {
    response.setHeader('Allow', 'GET, HEAD');
    return sendText(response, 405, 'Method not allowed.', isHead);
  }

  // The default is local-only. Public binding is explicit for a server deployment.
  const host = (request.headers.host || '').toLowerCase();
  const localOnly = bindHost === '127.0.0.1' || bindHost === 'localhost' || bindHost === '::1';
  if (localOnly && host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`) {
    return sendText(response, 403, 'Localhost access only.', isHead);
  }

  let pathname;
  try {
    pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  } catch {
    return sendText(response, 400, 'Invalid URL.', isHead);
  }
  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) {
    return sendText(response, 403, 'Invalid path.', isHead);
  }

  if (pathname === '/health') {
    const body = Buffer.from(JSON.stringify({ app: appId, version: 1, rootId, port, host: bindHost }));
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end(isHead ? undefined : body);
  }

  let target = path.resolve(distDirectory, `.${pathname}`);
  if (!isWithin(distDirectory, target)) return sendText(response, 403, 'Invalid path.', isHead);

  try {
    let fileInfo;
    try {
      fileInfo = await stat(target);
      if (fileInfo.isDirectory()) {
        target = path.join(target, 'index.html');
        fileInfo = await stat(target);
      }
    } catch (error) {
      // Missing assets stay 404; extensionless client-side routes load the app.
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      if (path.extname(pathname) || pathname.startsWith('/api/')) {
        return sendText(response, 404, 'Not found.', isHead);
      }
      target = path.join(distDirectory, 'index.html');
      fileInfo = await stat(target);
    }

    const realTarget = await realpath(target);
    if (!isWithin(realDistDirectory, realTarget)) return sendText(response, 403, 'Invalid path.', isHead);
    if (!fileInfo.isFile()) return sendText(response, 404, 'Not found.', isHead);

    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(realTarget).toLowerCase()) || 'application/octet-stream',
      'Content-Length': fileInfo.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (isHead) return response.end();
    const stream = createReadStream(realTarget);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (!response.headersSent) sendText(response, 500, 'Unable to read app file.', isHead);
    else response.destroy();
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : `Server failed: ${error.message}`);
  process.exit(1);
});
server.listen(port, bindHost, () => {
  const displayHost = bindHost === '0.0.0.0' ? '<服务器IP或域名>' : bindHost;
  console.log(`H12-821 practice ready at http://${displayHost}:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
