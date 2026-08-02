// Dev server for uk-rail-viz — replaces Python's broken http.server
// Usage: node tools/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || join(process.cwd(), 'dist');
const PORT = parseInt(process.argv[3]) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const file = join(ROOT, path);
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = extname(file);
    const type = MIME[ext] || 'application/octet-stream';
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`UK Rail Viz dev server → http://127.0.0.1:${PORT}`);
  console.log(`Serving ${ROOT}`);
});
