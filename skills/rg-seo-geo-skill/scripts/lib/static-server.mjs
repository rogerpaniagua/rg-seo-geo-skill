// Tiny static file server used by `--build <dir>` to audit a compiled site before it is deployed.
//
// Works for any static output (Astro, Hugo, Jekyll, Next export, Vite, plain HTML...). It mimics what
// static hosts do: index.html for folders, extensionless URLs, 404.html with a real 404 status.
//
// Production URLs inside the build (canonical, og:image, sitemap, robots) point at a domain that
// is not live yet. To audit the build as a self-consistent site, the server rewrites that production
// origin to the local origin in text responses. The audit core never knows the difference.
//
// SECURITY: loopback only, GET/HEAD only, and a request can never leave the build folder:
// dot-segments and encoded traversal are rejected, every candidate path is resolved with realpath
// and must stay inside the real root (so symlinks pointing out are refused), dotfiles are hidden.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseHtml, parseSitemap, parseRobots } from './html.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4',
};
const REWRITE = new Set(['.html', '.htm', '.xml', '.txt', '.json', '.webmanifest', '.md']);
const MAX_FILE = 25 * 1024 * 1024;

/** The domain the build is meant for, read from the homepage canonical / og:url, the sitemap or robots.txt. */
export function detectProductionOrigin(root) {
  const read = (f) => { try { const p = path.join(root, f); return fs.statSync(p).size < 5_000_000 ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
  const origin = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !['localhost', '127.0.0.1'].includes(x.hostname) ? x.origin : null; } catch { return null; } };
  const home = read('index.html');
  if (home) {
    const d = parseHtml(home);
    const found = origin(d.canonical) || origin(d.og['og:url']) || origin(d.og['og:image']);
    if (found) return found;
  }
  const sm = parseSitemap(read('sitemap.xml'));
  if (sm.entries.length && origin(sm.entries[0].loc)) return origin(sm.entries[0].loc);
  const rb = parseRobots(read('robots.txt'));
  return rb.sitemaps.length ? origin(rb.sitemaps[0]) : null;
}

function insideRoot(realRoot, real) { return real === realRoot || real.startsWith(realRoot + path.sep); }

function resolveFile(realRoot, rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  const segs = decoded.split('/').filter(Boolean);
  if (segs.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return { status: 404 };   // traversal and dotfiles
  const base = path.join(realRoot, ...segs);
  const wantsDir = decoded.endsWith('/') || segs.length === 0;
  const candidates = wantsDir ? [path.join(base, 'index.html')] : [base, base + '.html', path.join(base, 'index.html')];
  for (const cand of candidates) {
    let real;
    try { real = fs.realpathSync(cand); } catch { continue; }
    if (!insideRoot(realRoot, real)) return { status: 404 };                                        // symlink pointing out
    let st;
    try { st = fs.statSync(real); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_FILE) return { status: 413 };
    return { file: real, status: 200 };
  }
  return { status: 404 };
}

/** Start the server on 127.0.0.1 (random port). Returns { origin, productionOrigin, close() }. */
export async function serveStatic(rootDir) {
  const realRoot = fs.realpathSync(rootDir);
  if (!fs.statSync(realRoot).isDirectory()) throw new Error('not a directory');
  const productionOrigin = detectProductionOrigin(realRoot);
  let origin = '';

  const rewrite = (buf, ext) => {
    if (!productionOrigin || !REWRITE.has(ext)) return buf;
    const text = buf.toString('utf8');
    return text.includes(productionOrigin) ? Buffer.from(text.split(productionOrigin).join(origin), 'utf8') : buf;
  };

  const server = http.createServer((req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'content-length': body.length, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('allow', 'GET, HEAD'); return send(405, Buffer.from('Method not allowed')); }
    let pathname;
    try { pathname = new URL(req.url, 'http://local.invalid').pathname; } catch { return send(400, Buffer.from('Bad request')); }
    const r = resolveFile(realRoot, pathname);
    if (r.status === 200) {
      const ext = path.extname(r.file).toLowerCase();
      return send(200, rewrite(fs.readFileSync(r.file), ext), MIME[ext] || 'application/octet-stream');
    }
    if (r.status === 404) {
      const nf = resolveFile(realRoot, '/404.html');
      if (nf.status === 200) return send(404, rewrite(fs.readFileSync(nf.file), '.html'), MIME['.html']);
    }
    return send(r.status, Buffer.from(r.status === 404 ? 'Not found' : r.status === 413 ? 'Too large' : 'Bad request'));
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    productionOrigin,
    close: () => new Promise((resolve) => { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}
