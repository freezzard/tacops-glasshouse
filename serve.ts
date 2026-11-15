// serve.ts — a pocket static server for game/, used only while developing.
//
//   node serve.ts [--port 8080]
//
// It answers requests from the game/ folder next to this file, picks a
// content type by extension, and turns away anything that tries to climb
// out of that folder. No caching, no directory listing, nothing else.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--port');
const wanted = flagAt >= 0 ? Number(argv[flagAt + 1]) : 8080;
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65_536 ? wanted : 8080;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('unparsable path');
    return;
  }
  if (path.endsWith('/')) path += 'index.html';

  const filePath = resolve(join(gameDir, '.' + path));
  if (filePath !== gameDir && !filePath.startsWith(gameDir + sep)) {
    res.writeHead(403).end('outside the game folder');
    return;
  }

  let size: number;
  try {
    const info = statSync(filePath);
    if (!info.isFile()) throw new Error('directory');
    size = info.size;
  } catch {
    res.writeHead(404).end('no such file');
    return;
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(size),
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`glasshouse-breach dev server: http://localhost:${port}`);
});
