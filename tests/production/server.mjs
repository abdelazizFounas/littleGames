// Local test server: exercises the production CSP against the actual built PWA.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('packages/ui/dist');
const caddy = await readFile('server/docker/Caddyfile.prod', 'utf8');
const policy = caddy.match(/Content-Security-Policy "([^"]+)"/)?.[1];
if (!policy) throw new Error('Production Content Security Policy was not found.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
http.createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-cache');
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = resolve(root, `.${pathname}`);
    if (filename !== root && !filename.startsWith(root + sep)) {
      response.writeHead(400).end(); return;
    }
    try { if (!(await stat(filename)).isFile()) filename = resolve(root, 'index.html'); }
    catch { filename = resolve(root, 'index.html'); }
    response.setHeader('Content-Type', types[extname(filename)] ?? 'application/octet-stream');
    response.end(await readFile(filename));
  } catch {
    response.writeHead(500).end('Could not serve the production build.');
  }
}).listen(4176, '127.0.0.1');
