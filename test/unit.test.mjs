import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, parseRobots, robotsAllows, parseSitemap, imageSize } from '../skills/rg-seo-geo-skill/scripts/lib/html.mjs';
import { isPrivateIp, fetchUrl } from '../skills/rg-seo-geo-skill/scripts/lib/net.mjs';
import { CHECKS } from '../skills/rg-seo-geo-skill/scripts/lib/catalog.mjs';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';

test('parseHtml extracts head metadata, headings, links and JSON-LD', () => {
  const d = parseHtml(`<!doctype html><html lang="es"><head><title>Hola &amp; adiós</title>
    <meta name="description" content="Una descripción"><meta property="og:title" content="OG">
    <meta name="robots" content="noindex, nofollow"><link rel="canonical" href="https://a.com/x">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Person","name":"R"}]}</script>
    <script>var a="<h1>fake</h1>"</script></head>
    <body><h1>Uno</h1><h3>Salto</h3><a href="/a">a</a><a href="#">b</a><img src="x.png"><img src="y.png" alt=""></body></html>`);
  assert.equal(d.title, 'Hola & adiós');
  assert.equal(d.lang, 'es');
  assert.equal(d.canonical, 'https://a.com/x');
  assert.equal(d.og['og:title'], 'OG');
  assert.match(d.robotsMeta, /noindex/);
  assert.deepEqual(d.headings.map((h) => h.level), [1, 3]);
  assert.equal(d.images.filter((i) => i.alt === undefined).length, 1);
  assert.equal(d.jsonLd[0].nodes[0]['@type'], 'Person');
});

test('robots parser: longest match and allow wins ties', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private\nAllow: /private/ok\nSitemap: https://a.com/s.xml');
  assert.equal(robotsAllows(r, '*', '/'), false);
  assert.equal(robotsAllows(r, 'Googlebot', '/'), true);
  assert.equal(robotsAllows(r, 'Googlebot', '/private/x'), false);
  assert.equal(robotsAllows(r, 'Googlebot', '/private/ok/a'), true);
  assert.deepEqual(r.sitemaps, ['https://a.com/s.xml']);
});

test('sitemap parser handles urlset and index', () => {
  const u = parseSitemap('<urlset><url><loc>https://a.com/</loc><lastmod>2026-01-01</lastmod></url></urlset>');
  assert.equal(u.entries[0].loc, 'https://a.com/');
  assert.equal(u.isIndex, false);
  const i = parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>');
  assert.equal(i.isIndex, true);
  assert.equal(parseSitemap('<html>').valid, false);
});

test('imageSize reads PNG headers', () => {
  const b = Buffer.alloc(32); b[0] = 0x89; b[1] = 0x50; b.writeUInt32BE(1200, 16); b.writeUInt32BE(630, 20);
  assert.deepEqual(imageSize(b), { width: 1200, height: 630 });
});

test('SSRF guard blocks private ranges', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['192.0.0.1', '192.0.2.5', '198.51.100.7', '203.0.113.9', '100.64.0.1']) assert.ok(isPrivateIp(ip), ip);
  // regression: 192.0.77.48 is a public Automattic/WordPress CDN address, not a reserved range
  for (const ip of ['8.8.8.8', '1.1.1.1', '192.0.77.48', '2606:4700:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  const r = await fetchUrl('http://127.0.0.1:9/');
  assert.match(r.error, /Blocked/);
  const r2 = await fetchUrl('http://localhost:9/');
  assert.match(r2.error, /Blocked/);
  const r3 = await fetchUrl('file:///etc/passwd');
  assert.match(r3.error, /Unsupported protocol/);
});

test('catalog integrity', () => {
  const ids = new Set();
  for (const c of CHECKS) {
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`); ids.add(c.id);
    assert.ok(['blocker', 'important', 'advice'].includes(c.tier), c.id);
    assert.ok(['official', 'measured', 'heuristic'].includes(c.basis), c.id);
    assert.ok(['url', 'source'].includes(c.mode), c.id);
    for (const k of ['title', 'why', 'fix']) assert.ok(c[k].en && c[k].es, `${c.id}.${k} needs en+es`);
    assert.match(c.source, /^https:\/\//, c.id);
    // heuristics must never be able to block a launch
    if (c.basis === 'heuristic') assert.notEqual(c.tier, 'blocker', `${c.id}: heuristic cannot be a blocker`);
  }
});

test('collector keeps worst status and rejects unknown ids', () => {
  const c = new Collector();
  c.add('meta.title', 'pass', 'a', '/');
  c.add('meta.title', 'fail', 'missing', '/x');
  assert.equal(c.results()[0].status, 'fail');
  assert.throws(() => c.add('nope', 'pass'));
});

import http from 'node:http';
import zlib from 'node:zlib';

for (const [enc, compress] of [['gzip', zlib.gzipSync], ['br', zlib.brotliCompressSync], ['identity', (b) => b]]) {
  test(`oversized ${enc} response is truncated, never hangs`, async () => {
    const big = Buffer.from('<html>' + 'x'.repeat(2_000_000) + '</html>');
    const body = compress(big);
    const server = http.createServer((req, res) => { res.setHeader('content-encoding', enc); res.setHeader('content-type', 'text/html'); res.end(body); }).listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    const t0 = Date.now();
    const r = await fetchUrl(`http://127.0.0.1:${server.address().port}/`, { allowLocal: true, maxBytes: 100_000, timeout: 5000 });
    server.close();
    assert.ok(!r.error, r.error);
    assert.equal(r.status, 200);
    assert.equal(r.truncated, true);
    assert.ok(r.bytes <= 200_000);
    assert.ok(Date.now() - t0 < 5000, 'must resolve promptly');
  });
}

import { sameSite } from '../skills/rg-seo-geo-skill/scripts/lib/url-checks.mjs';
test('sameSite groups subdomains of the same registrable domain', () => {
  assert.ok(sameSite('en.wikipedia.org', 'www.wikipedia.org'));
  assert.ok(sameSite('www.bbc.co.uk', 'news.bbc.co.uk'));
  assert.ok(sameSite('example.com', 'www.example.com'));
  assert.ok(!sameSite('example.com', 'example.org'));
  assert.ok(!sameSite('a.co.uk', 'b.co.uk'));
});

import { httpsVerdict } from '../skills/rg-seo-geo-skill/scripts/lib/url-checks.mjs';
test('http→https verdict: only claim "no redirect" when HTTP really serves content', () => {
  assert.equal(httpsVerdict({ error: 'ECONNREFUSED', status: 0 }).status, 'pass');
  assert.equal(httpsVerdict({ status: 200, finalUrl: 'https://a.com/' }).status, 'pass');          // redirected to https
  assert.equal(httpsVerdict({ status: 200, finalUrl: 'http://a.com/' }).status, 'fail');           // served over plain http
  assert.equal(httpsVerdict({ status: 403, finalUrl: 'http://a.com/' }).status, 'skip');           // bot protection (DataDome on elpais.com)
  assert.equal(httpsVerdict({ status: 429, finalUrl: 'http://a.com/' }).status, 'skip');
  assert.equal(httpsVerdict({ status: 503, finalUrl: 'http://a.com/' }).status, 'skip');
});
