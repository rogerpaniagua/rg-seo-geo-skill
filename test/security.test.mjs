// Adversarial tests: the tool visits URLs it does not control, parses hostile HTML and writes
// reports that humans (and AI agents) read. Every test here is an attack that must fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPrivateIp } from '../skills/rg-seo-geo-skill/scripts/lib/net.mjs';
import { parseHtml, parseSitemap, extractJsonLd } from '../skills/rg-seo-geo-skill/scripts/lib/html.mjs';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';
import { runUrlAudit } from '../skills/rg-seo-geo-skill/scripts/lib/url-checks.mjs';
import { runNextAudit } from '../skills/rg-seo-geo-skill/scripts/lib/next-checks.mjs';
import { buildReport, toHtml, toMarkdown } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

test('SSRF: private addresses hidden inside IPv6 notations are blocked', () => {
  const blocked = [
    '::ffff:7f00:1',          // IPv4-mapped 127.0.0.1 in hex form
    '::ffff:a00:1',           // 10.0.0.1
    '::ffff:c0a8:101',        // 192.168.1.1
    '::ffff:a9fe:a9fe',       // 169.254.169.254 (cloud metadata)
    '::127.0.0.1',            // deprecated IPv4-compatible
    '64:ff9b::7f00:1',        // NAT64 embedding 127.0.0.1
    '64:ff9b::a9fe:a9fe',     // NAT64 embedding metadata IP
    '2002:7f00:1::',          // 6to4 embedding 127.0.0.1
    '2002:a9fe:a9fe::1',      // 6to4 embedding metadata IP
    'ff02::1', 'ff0e::1',     // multicast
    '::', '::1', 'fe80::1', 'fd12:3456::1', 'fc00::1',
    '0:0:0:0:0:ffff:7f00:1',  // fully expanded mapped form
  ];
  for (const ip of blocked) assert.ok(isPrivateIp(ip), `should block ${ip}`);
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808', '64:ff9b::808:808']) assert.ok(!isPrivateIp(ip), `should allow ${ip}`);
});

const serve = (handler) => new Promise((resolve) => {
  const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` }));
});

test('ReDoS: pathological HTML cannot hang the parser (quadratic regex backtracking)', () => {
  const MB = 'x'.repeat(0);
  const attacks = {
    'unclosed <a': '<a '.repeat(700_000),
    'unclosed <script': '<script '.repeat(400_000),
    'unclosed <h1': '<h1>'.repeat(500_000),
    'unclosed <meta': '<meta '.repeat(500_000),
    'unclosed <title': '<title>'.repeat(300_000),
    'ld+json openers': '<script type="application/ld+json">'.repeat(60_000),
    'comments': '<!--'.repeat(700_000),
  };
  for (const [name, html] of Object.entries(attacks)) {
    const t0 = Date.now();
    parseHtml(html + MB);
    extractJsonLd(html);
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `${name}: parser took ${ms}ms (quadratic?)`);
  }
});

test('ReDoS: pathological sitemap XML cannot hang the parser', () => {
  for (const xml of ['<urlset>' + '<url '.repeat(2_000_000), '<urlset>' + '<url><loc>'.repeat(800_000), '<sitemapindex>' + '<sitemap '.repeat(1_000_000)]) {
    const t0 = Date.now();
    parseSitemap(xml);
    assert.ok(Date.now() - t0 < 3000, `sitemap parse took ${Date.now() - t0}ms`);
  }
});

test('a hostile site cannot hang the whole audit', async () => {
  const bomb = '<html><head><title>x</title></head><body>' + '<a '.repeat(900_000) + '</body></html>';
  const { s, base } = await serve((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/robots.txt' ? 'x' : bomb); });
  const t0 = Date.now();
  try { await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 1 }, new Collector()); } finally { s.close(); }
  assert.ok(Date.now() - t0 < 15_000, `audit took ${Date.now() - t0}ms`);
});

const HOSTILE_TITLE = '<img src=x onerror=alert(1)><script>alert(2)</script> [click](javascript:alert(3))';

test('reports never contain raw markup taken from the audited site (HTML and Markdown)', async () => {
  const { s, base } = await serve((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/' ? `<!doctype html><html lang="en"><head><title>${HOSTILE_TITLE.replaceAll('<', '&lt;')}</title><meta name="description" content="${'<script>alert(4)</script>'.replaceAll('<', '&lt;')}"><link rel="canonical" href="javascript:alert(5)"></head><body><h1>${'<b onmouseover=alert(6)>'.replaceAll('<', '&lt;')}</h1><a href="/">x</a></body></html>` : 'nf');
  });
  const c = new Collector();
  let out;
  try { out = await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 1 }, c); } finally { s.close(); }
  const rep = buildReport(c.results(), { date: 'x', ...out.meta }, 'en');
  const html = toHtml(rep);
  const md = toMarkdown(rep);
  // The payload text may appear, but only as inert escaped text. What must never exist is a real tag.
  for (const bad of ['<script>alert', '<img src=x', '<b onmouseover']) {
    assert.ok(!html.includes(bad), `HTML report contains raw ${bad}`);
    assert.ok(!md.includes(bad), `Markdown report contains raw ${bad}`);
  }
  assert.ok(!/<(script|img|iframe|object|embed)\b/i.test(html), 'HTML report must not contain active elements');
  assert.ok(!/<[^>]*\son\w+\s*=/i.test(html), 'no real tag may carry an event-handler attribute');
  assert.ok(!/<[^>]*href\s*=\s*["']?\s*javascript:/i.test(html), 'no javascript: links');
  assert.ok(!/(?<!\\)\]\(\s*javascript:/i.test(md), 'Markdown must not contain an unescaped (live) javascript: link');
});

test('evidence from the site is bounded and stripped of control characters (it is read by humans and AI agents)', async () => {
  const long = 'A'.repeat(5000) + '\u0000\u001b[31m‮';
  const { s, base } = await serve((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html><head><title>${long}</title></head><body><h1>x</h1></body></html>`); });
  const c = new Collector();
  try { await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 1 }, c); } finally { s.close(); }
  for (const r of c.results()) for (const line of r.evidence) {
    assert.ok(line.length <= 420, `${r.id}: evidence line is ${line.length} chars`);
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/.test(line), `${r.id}: control chars in evidence`);
  }
});

test('source mode does not follow symlinks out of the project', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.tsx'), "export const metadata = { metadataBase: new URL('https://secret.example') }");
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.mkdirSync(path.join(proj, 'app'));
  fs.writeFileSync(path.join(proj, 'package.json'), '{"dependencies":{"next":"16.0.0"}}');
  fs.symlinkSync(path.join(outside, 'secret.tsx'), path.join(proj, 'app', 'layout.tsx'));
  const c = new Collector();
  runNextAudit({ src: proj }, c);
  const md = c.results().find((r) => r.id === 'next.metadata-base');
  assert.notEqual(md && md.status, 'pass', 'a symlinked layout outside the project must not be read');
  assert.ok(!JSON.stringify(c.results()).includes('secret.example'));
});
