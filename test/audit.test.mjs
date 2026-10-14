import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';
import { runUrlAudit } from '../skills/rg-seo-geo-skill/scripts/lib/url-checks.mjs';
import { runNextAudit } from '../skills/rg-seo-geo-skill/scripts/lib/next-checks.mjs';
import { buildReport, toHtml, toMarkdown } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const status = (results, id) => results.find((r) => r.id === id)?.status;

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

const GOOD_PAGE = (base, p, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page ${p} title here</title><meta name="description" content="A useful description of page ${p} that is long enough to be a snippet for people.">
<link rel="canonical" href="${base}${p}"><link rel="icon" href="/i.png">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:url" content="${base}${p}"><meta property="og:type" content="website">
<meta property="og:image" content="${base}/og.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"X","url":"${base}","sameAs":["https://a.com","https://b.com"]}</script>${extra}</head>
<body><h1>Heading</h1><h2>How does it work?</h2><ul><li>one</li></ul><p>${'word '.repeat(150)} 1 2 3 4 5 6</p><a href="/a">a</a><a href="/b">b</a><img src="/x.png" alt="x"></body></html>`;

function pngOg() { const b = Buffer.alloc(64); b[0] = 0x89; b[1] = 0x50; b.writeUInt32BE(1200, 16); b.writeUInt32BE(630, 20); return b; }

test('URL audit: healthy site passes the core checks', async () => {
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`); }
    if (u === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc><lastmod>2026-01-01</lastmod></url><url><loc>${base}/a</loc><lastmod>2026-02-03</lastmod></url><url><loc>${base}/b</loc><lastmod>2026-03-04</lastmod></url></urlset>`); }
    if (u === '/og.png') { res.setHeader('content-type', 'image/png'); return res.end(pngOg()); }
    if (u === '/' || u === '/a' || u === '/b') { res.setHeader('content-type', 'text/html'); return res.end(GOOD_PAGE(base, u === '/' ? '' : u)); }
    res.statusCode = 404; res.end('not found');
  });
  const c = new Collector();
  await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 3 }, c);
  s.close();
  const r = c.results();
  for (const id of ['crawl.page-ok', 'crawl.robots-exists', 'crawl.robots-open', 'crawl.sitemap-valid', 'crawl.sitemap-urls', 'crawl.soft-404', 'crawl.canonical', 'meta.title', 'meta.lang', 'meta.viewport', 'social.og-basics', 'social.og-image', 'social.og-image-size', 'schema.present', 'schema.valid', 'content.server-rendered', 'geo.search-bots']) {
    assert.equal(status(r, id), 'pass', `${id}: ${JSON.stringify(r.find((x) => x.id === id))}`);
  }
  assert.equal(status(r, 'crawl.sitemap-noindex'), 'pass');
});

test('URL audit: broken site is flagged', async () => {
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end('User-agent: *\nDisallow: /'); }
    if (u === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/old</loc></url><url><loc>${base}/hidden</loc></url></urlset>`); }
    if (u === '/old') { res.statusCode = 301; res.setHeader('location', '/'); return res.end(); }
    if (u === '/hidden') { res.setHeader('content-type', 'text/html'); res.setHeader('x-robots-tag', 'noindex'); return res.end('<html lang="en"><head><title>h</title></head><body><h1>x</h1></body></html>'); }
    res.setHeader('content-type', 'text/html');
    // everything else, including unknown URLs, returns 200 (soft 404). No title, no canonical, noindex meta.
    res.end('<html><head><meta name="robots" content="noindex"></head><body><div id="root"></div><img src="a.png"></body></html>');
  });
  const c = new Collector();
  await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 3 }, c);
  s.close();
  const r = c.results();
  assert.equal(status(r, 'crawl.not-noindex'), 'fail');
  assert.equal(status(r, 'crawl.robots-open'), 'fail');
  assert.equal(status(r, 'crawl.soft-404'), 'fail');
  assert.equal(status(r, 'crawl.sitemap-urls'), 'fail');
  assert.equal(status(r, 'crawl.sitemap-noindex'), 'fail');
  assert.equal(status(r, 'meta.title'), 'fail');
  assert.equal(status(r, 'meta.lang'), 'fail');
  assert.equal(status(r, 'meta.viewport'), 'fail');
  assert.equal(status(r, 'crawl.canonical'), 'warn');   // missing canonical is a recommendation gap, not a failure
  assert.equal(status(r, 'content.server-rendered'), 'fail');
  assert.equal(status(r, 'schema.present'), 'fail');
  assert.equal(buildReport(r, { date: 'x' }, 'en').verdict, 'not-ready');
});

test('URL audit refuses private addresses by default', async () => {
  const c = new Collector();
  const out = await runUrlAudit({ url: 'http://127.0.0.1:9/', allowLocal: false }, c);
  assert.equal(out.aborted, true);
  assert.match(out.meta.error, /Blocked/);
});

test('Next.js source audit: good fixture', () => {
  const c = new Collector();
  runNextAudit({ src: path.join(here, 'fixtures/next-good') }, c);
  const r = c.results();
  for (const id of ['next.metadata-base', 'next.root-metadata', 'next.social', 'next.canonical', 'next.sitemap-file', 'next.robots-file', 'next.dynamic-metadata', 'next.client-page', 'next.icons', 'next.jsonld', 'next.not-found', 'next.host-consistency']) {
    assert.equal(status(r, id), 'pass', `${id}: ${JSON.stringify(r.find((x) => x.id === id))}`);
  }
});

test('Next.js source audit: bad fixture', () => {
  const c = new Collector();
  runNextAudit({ src: path.join(here, 'fixtures/next-bad') }, c);
  const r = c.results();
  const expectFail = ['next.metadata-base', 'next.social', 'next.canonical', 'next.robots-file', 'next.sitemap-coverage', 'next.host-consistency', 'next.dynamic-metadata', 'next.page-metadata', 'next.client-page'];
  for (const id of expectFail) assert.equal(status(r, id), 'fail', `${id}: ${JSON.stringify(r.find((x) => x.id === id))}`);
  assert.equal(status(r, 'next.sitemap-lastmod'), 'warn');
  assert.equal(status(r, 'next.img-tag'), 'warn');
  assert.equal(status(r, 'next.not-found'), 'warn');
});

test('non-Next projects are skipped with a note', () => {
  const c = new Collector();
  const out = runNextAudit({ src: path.join(here, 'fixtures') }, c);
  assert.equal(out.skipped, true);
  assert.match(out.meta.note, /Next\.js/);
});

test('reports render in both languages without throwing', () => {
  const c = new Collector();
  runNextAudit({ src: path.join(here, 'fixtures/next-bad') }, c);
  for (const lang of ['en', 'es']) {
    const rep = buildReport(c.results(), { date: '2026-10-13', src: 'x', framework: 'Next.js' }, lang);
    assert.match(toHtml(rep), /<!doctype html>/);
    assert.match(toMarkdown(rep), /^# /);
  }
});

import { detectStack } from '../skills/rg-seo-geo-skill/scripts/lib/stack.mjs';
import { validateLinks } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

test('no sitemap: discovers pages through internal links, small site is a warning not a failure', async () => {
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/' || u === '/about' || u === '/contact') {
      res.setHeader('content-type', 'text/html');
      return res.end(GOOD_PAGE(base, u === '/' ? '' : u).replace('<a href="/a">a</a><a href="/b">b</a>', '<a href="/about">about</a><a href="/contact">contact</a><a href="/img.png">img</a>'));
    }
    res.statusCode = 404; res.end('nf');
  });
  const c = new Collector();
  const out = await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 4 }, c);
  s.close();
  const paths = out.meta.pages.map((p) => new URL(p).pathname).sort();
  assert.deepEqual(paths, ['/', '/about', '/contact']);   // the .png link is not treated as a page
  assert.equal(out.meta.discoveredPages, true);
  assert.equal(status(c.results(), 'crawl.sitemap-valid'), 'warn');
});

test('no sitemap on a large site (>50 links) is a failure', async () => {
  const links = Array.from({ length: 60 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('');
  const { s, base } = await serve((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(GOOD_PAGE(base, '').replace('<a href="/a">a</a><a href="/b">b</a>', links)); }
    res.statusCode = 404; res.end('nf');
  });
  const c = new Collector();
  await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 2 }, c);
  s.close();
  assert.equal(status(c.results(), 'crawl.sitemap-valid'), 'fail');
});

test('client-rendered shell is flagged in the report notes', async () => {
  const { s, base } = await serve((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
    res.statusCode = 404; res.end('nf');
  });
  const c = new Collector();
  const out = await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 1 }, c);
  s.close();
  assert.ok(out.meta.notes.includes('client-shell'));
  assert.match(toHtml(buildReport(c.results(), { ...out.meta, date: 'x' }, 'es')), /JavaScript/);
});

test('stack detection from page signals', () => {
  assert.equal(detectStack('<link href="/wp-content/themes/x/style.css">'), 'WordPress');
  assert.equal(detectStack('<script src="https://cdn.shopify.com/s/x.js">'), 'Shopify');
  assert.equal(detectStack('<script src="/_next/static/a.js">'), 'Next.js');
  assert.equal(detectStack('<html>', {}, { generator: 'Astro v5' }), 'Astro');
  assert.equal(detectStack('<html><body>plain</body></html>'), null);
});

test('validation links are pre-filled with the audited URL and no performance checks remain', () => {
  const v = validateLinks({ finalUrl: 'https://example.com/a b', hasSitemap: false }, 'es');
  assert.ok(v.find((x) => x.name === 'PageSpeed Insights').url.includes(encodeURIComponent('https://example.com/a b')));
  assert.ok(v.length >= 5);
  assert.deepEqual(validateLinks({}, 'en'), []);
});

// ---- regression: rate limiting (429) must never be reported as a site error ----
test('fetchUrl retries a 429 and honours Retry-After', async () => {
  let hits = 0;
  const { s, base } = await serve((req, res) => {
    hits++;
    if (hits === 1) { res.statusCode = 429; res.setHeader('retry-after', '0'); return res.end('slow down'); }
    res.setHeader('content-type', 'text/html'); res.end('<html>ok</html>');
  });
  const { fetchUrl } = await import('../skills/rg-seo-geo-skill/scripts/lib/net.mjs');
  const r = await fetchUrl(base + '/', { allowLocal: true });
  s.close();
  assert.equal(r.status, 200);
  assert.equal(hits, 2);
});

test('persistent 429 on a sampled page is "not evaluated", not a blocker', async () => {
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`); }
    if (u === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/limited</loc></url></urlset>`); }
    if (u === '/limited') { res.statusCode = 429; res.setHeader('retry-after', '0'); return res.end('no'); }
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(GOOD_PAGE(base, '')); }
    res.statusCode = 404; res.end('nf');
  });
  const c = new Collector();
  await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 3 }, c);
  s.close();
  const pageOk = c.results().find((r) => r.id === 'crawl.page-ok');
  assert.notEqual(pageOk.status, 'fail', JSON.stringify(pageOk));
  assert.match(pageOk.evidence.join(' '), /rate-limit/i);
});

test('homepage that only returns 429 gives an "incomplete" verdict, never "solid"', async () => {
  const { s, base } = await serve((req, res) => { res.statusCode = 429; res.setHeader('retry-after', '0'); res.end('no'); });
  const c = new Collector();
  const out = await runUrlAudit({ url: base + '/', allowLocal: true }, c);
  s.close();
  assert.equal(out.aborted, true);
  assert.equal(buildReport(c.results(), { date: 'x', ...out.meta }, 'es').verdict, 'incomplete');
});

// ---- regression: noise found in the skill test on wordpress.org ----
test('16:9 share images are accepted; legal pages are not asked for author/date', async () => {
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/og.png') { const b = Buffer.alloc(64); b[0] = 0x89; b[1] = 0x50; b.writeUInt32BE(2400, 16); b.writeUInt32BE(1350, 20); res.setHeader('content-type', 'image/png'); return res.end(b); }
    if (u === '/robots.txt') { res.statusCode = 404; return res.end(); }
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(GOOD_PAGE(base, '').replace('<meta property="og:type" content="website">', '<meta property="og:type" content="article">')); }
    res.statusCode = 404; res.end('nf');
  });
  const c = new Collector();
  await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 1 }, c);
  s.close();
  const r = c.results();
  assert.equal(status(r, 'social.og-image-size'), 'pass');
  assert.equal(r.find((x) => x.id === 'geo.freshness-author'), undefined);   // og:type=article alone is not enough
});

// ---- calibration from the 27-site corpus (test/corpus.txt) ----
import { CHECK_BY_ID } from '../skills/rg-seo-geo-skill/scripts/lib/catalog.mjs';

async function auditPages(handler, opts = {}) {
  const { s, base } = await serve((req, res) => handler(req, res, base_()));
  function base_() { return `http://127.0.0.1:${s.address().port}`; }
  const c = new Collector();
  let out;
  try { out = await runUrlAudit({ url: base + '/', allowLocal: true, maxPages: 4, ...opts }, c); } finally { s.close(); }
  return { c, out, r: c.results(), base };
}
const html = (head = '', body = '<h1>Hello</h1><p>' + 'word '.repeat(120) + '</p><a href="/x">x</a>') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A reasonable page title</title>${head}</head><body>${body}</body></html>`;

test('very large response headers (webflow.com sends ~16.5 KB) do not break the audit', async () => {
  const { fetchUrl } = await import('../skills/rg-seo-geo-skill/scripts/lib/net.mjs');
  const { s, base } = await serve((req, res) => { res.setHeader('x-big', 'a'.repeat(20_000)); res.setHeader('content-type', 'text/plain'); res.end('ok'); });
  const r = await fetchUrl(base + '/', { allowLocal: true });
  s.close();
  assert.equal(r.status, 200, r.error);
});

test('bot protection (403) on the homepage is "could not audit", never a site blocker', async () => {
  const { c, out } = await auditPages((req, res) => { res.statusCode = 403; res.end('Access denied'); });
  assert.equal(out.aborted, true);
  const pageOk = c.results().find((x) => x.id === 'crawl.page-ok');
  assert.equal(pageOk.status, 'skip');
  assert.match(pageOk.evidence.join(' '), /automated|refused/i);
  assert.equal(buildReport(c.results(), { date: 'x' }, 'en').verdict, 'incomplete');
});

test('non-HTML URLs (markdown, plain text) are skipped, not failed for missing viewport/canonical', async () => {
  const { r } = await auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/SKILL.md</loc></url></urlset>`); }
    if (req.url === '/SKILL.md') { res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end('# a markdown file'); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  });
  assert.notEqual(status(r, 'meta.viewport'), 'fail');
  assert.notEqual(status(r, 'crawl.canonical'), 'fail');
  assert.match(r.find((x) => x.id === 'crawl.page-ok').evidence.join(' '), /not an HTML page/);
});

test('canonical: missing is a warning; pointing a deep page at the homepage is a failure; pointing elsewhere is a warning', async () => {
  const pageWith = (canon) => html(canon ? `<link rel="canonical" href="${canon}">` : '');
  const run = async (canonFor) => (await auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/docs/a</loc></url></urlset>`); }
    if (req.url === '/' || req.url === '/docs/a') { res.setHeader('content-type', 'text/html'); return res.end(pageWith(canonFor(req.url, base))); }
    res.statusCode = 404; res.end('nf');
  })).r;
  assert.equal(status(await run(() => null), 'crawl.canonical'), 'warn');
  assert.equal(status(await run((u, b) => (u === '/' ? b + '/' : b + '/')), 'crawl.canonical'), 'fail');         // deep page -> home
  assert.equal(status(await run((u, b) => (u === '/' ? b + '/' : b + '/docs/other')), 'crawl.canonical'), 'warn'); // consolidation elsewhere
  assert.equal(status(await run((u, b) => b + u), 'crawl.canonical'), 'pass');
});

test('missing description: failure on the homepage, warning on secondary pages', async () => {
  const mk = (homeDesc) => auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/docs</loc></url></urlset>`); }
    res.setHeader('content-type', 'text/html');
    const d = '<meta name="description" content="' + 'A good description. '.repeat(5) + '">';
    if (req.url === '/') return res.end(html(homeDesc ? d : ''));
    if (req.url === '/docs') return res.end(html(''));
    res.statusCode = 404; res.end('nf');
  });
  assert.equal(status((await mk(true)).r, 'meta.description'), 'warn');
  assert.equal(status((await mk(false)).r, 'meta.description'), 'fail');
});

test('tiny static pages are not "client-rendered" failures; empty JS shells are', async () => {
  const tiny = await auditPages((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html('', '<h1>Hi</h1><p>A tiny but real page.</p><a href="/x">x</a>')); });
  assert.equal(status(tiny.r, 'content.server-rendered'), 'warn');
  const shell = await auditPages((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html('', '<div id="root"></div><script src="/b.js"></script>')); });
  assert.equal(status(shell.r, 'content.server-rendered'), 'fail');
});

test('sitemap discovery tries common locations when robots.txt lists none', async () => {
  const { r } = await auditPages((req, res, base) => {
    if (req.url === '/sitemap_index.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url></urlset>`); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  });
  assert.equal(status(r, 'crawl.sitemap-valid'), 'pass');
});

test('calibrated tiers: things Google does not require are not "important"', () => {
  assert.equal(CHECK_BY_ID.get('meta.h1').tier, 'advice');
  assert.equal(CHECK_BY_ID.get('schema.present').tier, 'advice');
});

// ---- regressions from the corpus run #2 ----
test('huge sitemaps (150k URLs, e.g. webflow.com) do not overflow the stack', async () => {
  const urls = Array.from({ length: 150_000 }, (_, i) => `<url><loc>__B__/p/${i}</loc></url>`).join('');
  const { r } = await auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset>${urls.replaceAll('__B__', base)}</urlset>`); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 2 });
  assert.equal(status(r, 'crawl.sitemap-valid'), 'pass');
  assert.equal(status(r, 'crawl.sitemap-limits'), 'fail');   // 150k > 50,000
});

test('robots.txt that blocks AI search bots is a policy warning, not a failure', async () => {
  const { r } = await auditPages((req, res) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end('User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nAllow: /'); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  });
  const x = r.find((y) => y.id === 'geo.search-bots');
  assert.equal(x.status, 'warn');
  assert.match(x.evidence.join(' '), /PerplexityBot/);
});

test('sitemap URLs: another domain is a failure', async () => {
  const run = (loc) => auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${loc}</loc></url></urlset>`); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  assert.equal(status((await run('http://other.example.org/x')).r, 'crawl.sitemap-urls'), 'fail');
});

test('sitemap limit is per file: an index of several files totalling >50k URLs is fine', async () => {
  const child = (base, n, off) => `<urlset>${Array.from({ length: n }, (_, i) => `<url><loc>${base}/p/${off + i}</loc></url>`).join('')}</urlset>`;
  const { r } = await auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    res.setHeader('content-type', 'application/xml');
    if (req.url === '/sitemap.xml') return res.end(`<sitemapindex><sitemap><loc>${base}/s1.xml</loc></sitemap><sitemap><loc>${base}/s2.xml</loc></sitemap></sitemapindex>`);
    if (req.url === '/s1.xml') return res.end(child(base, 30_000, 0));
    if (req.url === '/s2.xml') return res.end(child(base, 30_000, 30_000));
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  assert.equal(status(r, 'crawl.sitemap-limits'), 'pass', JSON.stringify(r.find((x) => x.id === 'crawl.sitemap-limits')));
});

// ---- site health: broken and redirected internal links ----
test('broken internal links (404/410) fail; redirected links warn; blocked links are not evaluated', async () => {
  const links = ['/ok', '/gone', '/missing', '/redir', '/boom', '/blocked'].map((p) => `<a href="${p}">${p}</a>`).join('');
  const { r } = await auditPages((req, res) => {
    const u = req.url;
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(html('', `<h1>Home</h1><p>${'word '.repeat(120)}</p>${links}`)); }
    if (u === '/ok') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    if (u === '/gone') { res.statusCode = 410; return res.end(); }
    if (u === '/redir') { res.statusCode = 301; res.setHeader('location', '/ok'); return res.end(); }
    if (u === '/boom') { res.statusCode = 500; return res.end(); }
    if (u === '/blocked') { res.statusCode = 403; return res.end(); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  const broken = r.find((x) => x.id === 'health.broken-links');
  assert.equal(broken.status, 'fail');
  assert.match(broken.evidence.join(' '), /\/gone/);
  assert.match(broken.evidence.join(' '), /\/missing/);
  assert.doesNotMatch(broken.evidence.join(' '), /\/ok\b|\/blocked/);
  assert.equal(status(r, 'health.redirected-links'), 'warn');
  assert.match(r.find((x) => x.id === 'health.redirected-links').evidence.join(' '), /\/redir/);
});

test('healthy internal links pass', async () => {
  const { r } = await auditPages((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/' ) return res.end(html('', `<h1>Home</h1><p>${'word '.repeat(120)}</p><a href="/a">a</a><a href="/b#frag">b</a>`));
    if (req.url === '/a' || req.url === '/b') return res.end(html());
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  assert.equal(status(r, 'health.broken-links'), 'pass');
  assert.equal(status(r, 'health.redirected-links'), 'pass');
});

// ---- calibration of the health checks against the real corpus ----
test('redirected links: only permanent redirects (301/308) are advice; temporary and auth/API redirects are intentional', async () => {
  const links = ['/perm', '/perm308', '/temp302', '/temp307', '/api/auth/start', '/login'].map((p) => `<a href="${p}">${p}</a>`).join('');
  const { r } = await auditPages((req, res) => {
    const u = req.url;
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(html('', `<h1>Home</h1><p>${'word '.repeat(120)}</p>${links}`)); }
    const codes = { '/perm': 301, '/perm308': 308, '/temp302': 302, '/temp307': 307, '/api/auth/start': 301, '/login': 301 };
    if (codes[u]) { res.statusCode = codes[u]; res.setHeader('location', '/'); return res.end(); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  const x = r.find((y) => y.id === 'health.redirected-links');
  assert.equal(x.status, 'warn');
  const ev = x.evidence.join(' ');
  assert.match(ev, /\/perm\b/);
  assert.match(ev, /\/perm308/);
  assert.doesNotMatch(ev, /temp302|temp307|api\/auth|login/);
});

test('a link that fails on HEAD but works on GET is not broken', async () => {
  const { r } = await auditPages((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html('', `<h1>Home</h1><p>${'word '.repeat(120)}</p><a href="/headbug">x</a>`)); }
    if (req.url === '/headbug') { if (req.method === 'HEAD') { res.statusCode = 500; return res.end(); } res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 1 });
  assert.equal(status(r, 'health.broken-links'), 'pass');
});

test('trust pages: warn only when the homepage gives NO "who is behind this" link at all', async () => {
  const run = (links) => auditPages((req, res) => { if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html('', `<h1>Home</h1><p>${'word '.repeat(120)}</p>${links}`)); } res.statusCode = 404; res.end('nf'); }, { maxPages: 1 });
  assert.equal(status((await run('<a href="/about">a</a>')).r, 'geo.trust-pages'), 'pass');
  assert.equal(status((await run('<a href="#contact">c</a>')).r, 'geo.trust-pages'), 'pass');
  assert.equal(status((await run('<a href="/blog">b</a>')).r, 'geo.trust-pages'), 'warn');
});

// ---- found while auditing elaniin.com with a real team ----
test('sitemap URLs refused with 401/403/429/503 are "not evaluated", never failures', async () => {
  const mk = (extra) => auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/ok</loc></url><url><loc>${base}/protected</loc></url>${extra ? `<url><loc>${base}/gone</loc></url>` : ''}</urlset>`); }
    if (req.url === '/' || req.url === '/ok') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    if (req.url === '/protected') { res.statusCode = 403; return res.end('Access denied'); }
    res.statusCode = 404; res.end('nf');
  }, { maxPages: 2 });
  const protectedOnly = (await mk(false)).r.find((x) => x.id === 'crawl.sitemap-urls');
  assert.equal(protectedOnly.status, 'pass', JSON.stringify(protectedOnly));
  assert.match(protectedOnly.evidence.join(' '), /not evaluated.*\/protected|\/protected.*not evaluated/i);
  const withBroken = (await mk(true)).r.find((x) => x.id === 'crawl.sitemap-urls');
  assert.equal(withBroken.status, 'fail');
  assert.match(withBroken.evidence.join(' '), /\/gone/);
  assert.doesNotMatch(withBroken.evidence.join(' '), /\/protected: HTTP 403/);      // the refused URL is not reported as broken
});

test('sitemap URLs: when every sampled URL is refused the check is skipped, not passed', async () => {
  const { r } = await auditPages((req, res, base) => {
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end(`Sitemap: ${base}/sitemap.xml`); }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); return res.end(`<urlset><url><loc>${base}/a</loc></url><url><loc>${base}/b</loc></url></urlset>`); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(html()); }
    res.statusCode = 403; res.end('no');
  }, { maxPages: 1 });
  assert.equal(status(r, 'crawl.sitemap-urls'), 'skip');
});

const botServer = (blockedRe) => auditPages((req, res) => {
  if (req.url === '/') {
    if (blockedRe.test(String(req.headers['user-agent'] || ''))) { res.statusCode = 403; return res.end('blocked'); }
    res.setHeader('content-type', 'text/html'); return res.end(html());
  }
  res.statusCode = 404; res.end('nf');
}, { maxPages: 1 });

test('AI bots at the server: blocking only TRAINING bots (GPTBot, ClaudeBot) is a policy choice, not a warning', async () => {
  const { r } = await botServer(/GPTBot|ClaudeBot/);
  const x = r.find((y) => y.id === 'geo.bot-access');
  assert.equal(x.status, 'pass', JSON.stringify(x));
  assert.match(x.evidence.join(' '), /GPTBot/);
  assert.match(x.evidence.join(' '), /ClaudeBot/);
  assert.match(x.evidence.join(' '), /training/i);
  assert.match(x.evidence.join(' '), /search/i);                       // says the search bots get through
});

test('AI bots at the server: blocking a SEARCH bot (OAI-SearchBot, PerplexityBot) warns and names it', async () => {
  const one = (await botServer(/OAI-SearchBot/)).r.find((y) => y.id === 'geo.bot-access');
  assert.equal(one.status, 'warn');
  assert.match(one.evidence.join(' '), /OAI-SearchBot/);
  const all = (await botServer(/GPTBot|ClaudeBot|OAI-SearchBot|PerplexityBot/)).r.find((y) => y.id === 'geo.bot-access');
  assert.equal(all.status, 'warn');
  assert.match(all.evidence.join(' '), /PerplexityBot/);
  assert.equal((await botServer(/nothing-matches-this/)).r.find((y) => y.id === 'geo.bot-access').status, 'pass');
});
