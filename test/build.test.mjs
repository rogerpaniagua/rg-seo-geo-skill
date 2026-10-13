import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../skills/rg-seo-geo-skill/scripts/lib/static-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, 'fixtures/build-site');
const CLI = path.join(here, '../skills/rg-seo-geo-skill/scripts/audit.mjs');

const get = (base, p, headers = {}) => new Promise((resolve, reject) => {
  http.get(base + p, { headers }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', reject);
});

test('static server: index files, extensionless paths, 404 page with a real 404 status', async () => {
  const srv = await serveStatic(SITE);
  try {
    assert.equal((await get(srv.origin, '/')).status, 200);
    assert.match((await get(srv.origin, '/blog/')).body, /<h1>Blog<\/h1>/);
    assert.equal((await get(srv.origin, '/blog')).status, 200);                       // directory without trailing slash
    assert.equal((await get(srv.origin, '/sitemap.xml')).headers['content-type'].split(';')[0], 'application/xml');
    const nf = await get(srv.origin, '/nope');
    assert.equal(nf.status, 404);
    assert.match(nf.body, /404/);                                                       // serves 404.html
    assert.equal((await get(srv.origin, '/robots.txt')).headers['content-type'].split(';')[0], 'text/plain');
  } finally { await srv.close(); }
});

test('static server cannot be escaped: traversal, encoded traversal, symlinks, dotfiles, non-GET', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html>ok</html>');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=1');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(outside, path.join(root, 'dirlink'));
  const srv = await serveStatic(root);
  try {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/link.txt', '/dirlink/secret.txt', '/.env', '/%00', '/a\\..\\b']) {
      const r = await get(srv.origin, p);
      assert.notEqual(r.status, 200, `${p} must not be served`);
      assert.ok(!r.body.includes('TOP-SECRET') && !r.body.includes('API_KEY'), `${p} leaked content`);
    }
    // only GET and HEAD
    const post = await new Promise((resolve) => { const req = http.request(srv.origin + '/', { method: 'POST' }, (res) => resolve(res.statusCode)); req.end(); });
    assert.equal(post, 405);
    assert.match(srv.origin, /^http:\/\/127\.0\.0\.1:\d+$/);                            // loopback only, never 0.0.0.0
  } finally { await srv.close(); }
});

const run = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args, '--quiet', '--lang', 'en'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('close', (code) => resolve({ code, o }));
});

test('--build audits a compiled site folder, judging URLs by path (production domain is not deployed yet)', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'build-out-'));
  const r = await run(['--build', SITE, '--out', out, '--pages', '6']);
  assert.equal(r.code, 0, r.o);
  const j = JSON.parse(fs.readFileSync(path.join(out, 'audit.json'), 'utf8'));
  const st = (id) => j.findings.find((f) => f.id === id);
  assert.equal(st('crawl.robots-exists').status, 'pass');
  assert.equal(st('crawl.sitemap-valid').status, 'pass');
  assert.equal(st('crawl.sitemap-urls').status, 'pass', JSON.stringify(st('crawl.sitemap-urls')));   // production-host URLs are mapped to the local build
  assert.equal(st('social.og-image').status, 'pass', JSON.stringify(st('social.og-image')));         // production og:image is read from the build
  assert.equal(st('crawl.soft-404').status, 'pass');
  assert.equal(st('crawl.https').status, 'skip');
  assert.equal(st('crawl.single-host').status, 'skip');
  // real problems planted in the fixture are still found
  assert.equal(st('health.broken-links').status, 'fail');
  assert.match(st('health.broken-links').evidence.join(' '), /\/missing/);
  assert.equal(st('crawl.canonical').status, 'fail');            // /about/ canonical points at the homepage
  assert.match(st('crawl.canonical').evidence.join(' '), /about/);
  assert.equal(j.meta.build, true);
  assert.ok(!JSON.stringify(j.meta).includes(os.tmpdir()), 'the report must not leak absolute local paths');
});

test('--build and --url are mutually exclusive; --build needs a directory', async () => {
  const a = await run(['--build', SITE, '--url', 'https://example.com', '--out', os.tmpdir()]);
  assert.equal(a.code, 2); assert.match(a.o, /--build/);
  const b = await run(['--build', path.join(SITE, 'index.html'), '--out', os.tmpdir()]);
  assert.equal(b.code, 2); assert.match(b.o, /directory/i);
  const c = await run(['--build', path.join(os.tmpdir(), 'definitely-not-here-xyz'), '--out', os.tmpdir()]);
  assert.equal(c.code, 2);
});
