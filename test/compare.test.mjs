import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareAudits, buildReport, toHtml, toMarkdown } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../skills/rg-seo-geo-skill/scripts/audit.mjs');

const f = (id, status) => ({ id, status });

test('compareAudits: resolved, regressed, still open and new', () => {
  const prev = { meta: { date: '2026-10-01' }, verdict: 'needs-work', findings: [
    f('meta.title', 'pass'), f('crawl.canonical', 'fail'), f('meta.description', 'warn'),
    f('social.og-image', 'fail'), f('crawl.https', 'pass'), f('geo.llms-txt', 'info'),
  ] };
  const cur = [
    f('meta.title', 'fail'),            // regression
    f('crawl.canonical', 'pass'),       // resolved
    f('meta.description', 'warn'),      // still open
    f('social.og-image', 'warn'),       // improved but still open
    f('crawl.https', 'pass'),
    f('geo.llms-txt', 'info'),
    f('health.broken-links', 'fail'),   // not in the previous audit
  ];
  const r = compareAudits(prev, cur);
  assert.deepEqual(r.resolved, ['crawl.canonical']);
  assert.deepEqual(r.regressed, ['meta.title']);
  assert.deepEqual(r.stillOpen.sort(), ['meta.description', 'social.og-image']);
  assert.deepEqual(r.newIssues, ['health.broken-links']);
  assert.deepEqual(r.improved, ['social.og-image']);
  assert.equal(r.previousDate, '2026-10-01');
});

test('compareAudits treats a previous file as untrusted: unknown ids and statuses are ignored', () => {
  const r = compareAudits({ meta: { date: '<script>x</script>' }, verdict: 'solid', findings: [f('not.a.check', 'fail'), f('meta.title', 'evil'), { nope: 1 }, null, f('crawl.canonical', 'fail')] },
    [f('crawl.canonical', 'pass')]);
  assert.deepEqual(r.resolved, ['crawl.canonical']);
  assert.equal(r.previousDate, undefined);               // free text is never echoed; only a real ISO date is
  assert.throws(() => compareAudits({ findings: 'nope' }, []), /findings/);
});

test('reports show the progress section, in both languages, with escaped data', () => {
  const prev = { meta: { date: '2026-10-01' }, verdict: 'not-ready', findings: [f('crawl.canonical', 'fail')] };
  const cur = [f('crawl.canonical', 'pass')];
  for (const lang of ['en', 'es']) {
    const rep = buildReport(cur, { date: '2026-10-13', finalUrl: 'https://a.com/' }, lang, prev);
    const html = toHtml(rep);
    const md = toMarkdown(rep);
    assert.match(html, lang === 'en' ? /Progress since/ : /Progreso desde/);
    assert.match(md, lang === 'en' ? /Progress since/ : /Progreso desde/);
    assert.equal(rep.progress.resolved.length, 1);
  }
  assert.equal(buildReport(cur, { date: 'x' }, 'en').progress, undefined);
});

test('CLI: --compare auto reads the previous audit.json from the output folder', async () => {
  let broken = true;
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url></urlset>`); }
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>A reasonable title</title>${broken ? '' : `<link rel="canonical" href="${base}/">`}</head><body><h1>x</h1><p>${'word '.repeat(120)}</p></body></html>`);
    }
    res.statusCode = 404; res.end('nf');
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  const run = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, '--url', url, '--allow-local', '--out', out, '--quiet', '--lang', 'en', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
    p.on('close', (code) => resolve({ code, o }));
  });
  try {
    const first = await run(['--pages', '1']);
    assert.equal(first.code, 0, first.o);
    assert.ok(!/Progress since/.test(fs.readFileSync(path.join(out, 'report.html'), 'utf8')), 'no progress section on the first run');
    broken = false;                                  // the site is fixed
    const second = await run(['--pages', '1', '--compare', 'auto']);
    assert.equal(second.code, 0, second.o);
    const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
    assert.match(html, /Progress since/);
    assert.match(html, /Resolved/);
    const bad = await run(['--pages', '1', '--compare', path.join(out, 'does-not-exist.json')]);
    assert.equal(bad.code, 2);
    assert.match(bad.o, /compare/i);
  } finally { server.close(); }
});
