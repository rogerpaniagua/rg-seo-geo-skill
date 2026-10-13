// URL mode: audits a published site the way a crawler sees it. Works for any stack.

import { fetchUrl } from './net.mjs';
import { parseHtml, parseRobots, robotsAllows, parseSitemap, imageSize } from './html.mjs';
import { detectStack, looksLikeClientShell } from './stack.mjs';
import { findMixedContent, imageDimensionIssues, trustSignals } from './health.mjs';
import net from 'node:net';

const SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User', 'Googlebot', 'Bingbot'];
const TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider'];
const BOT_UAS = {
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
};
const REQUIRED_PROPS = {
  Article: ['headline', 'author', 'datePublished'], BlogPosting: ['headline', 'author', 'datePublished'], NewsArticle: ['headline', 'author', 'datePublished'],
  Organization: ['name', 'url'], Person: ['name'], WebSite: ['url'], LocalBusiness: ['name', 'address'],
  Product: ['name'], BreadcrumbList: ['itemListElement'], FAQPage: ['mainEntity'],
};

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'gob', 'or', 'ne']);
function registrable(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return host.toLowerCase();
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  return (tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3) : parts.slice(-2)).join('.');
}
/** True when two hosts belong to the same site (same registrable domain), e.g. en.wikipedia.org and www.wikipedia.org. */
export function sameSite(a, b) { return registrable(a) === registrable(b); }

const norm = (u) => {
  try {
    const x = new URL(u);
    x.hash = '';
    let p = x.pathname.replace(/\/+$/, '');
    if (p === '') p = '/';
    return `${x.protocol}//${x.host.toLowerCase()}${p}${x.search}`;
  } catch { return u; }
};
const types = (node) => [].concat(node['@type'] || []);
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

/** Judge the plain-HTTP probe. Only a 2xx served over http:// is a real failure; a refusal (403 bot protection, 429, 5xx) proves nothing. */
export function httpsVerdict(httpRes) {
  if (httpRes.error) return { status: 'pass', evidence: 'HTTPS ok; plain HTTP not reachable' };
  if (new URL(httpRes.finalUrl).protocol === 'https:') return { status: 'pass', evidence: 'HTTP redirects to HTTPS' };
  if (httpRes.status >= 200 && httpRes.status < 300) return { status: 'fail', evidence: `http:// does not redirect to https:// (final ${httpRes.finalUrl})` };
  return { status: 'skip', evidence: `could not verify: http:// answered HTTP ${httpRes.status} (often bot protection)` };
}

const contentType = (res) => String((res.headers && res.headers['content-type']) || '').split(';')[0].trim().toLowerCase();
const isHtml = (res) => { const t = contentType(res); return !t || t === 'text/html' || t === 'application/xhtml+xml'; };

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function pickSample(urls, startUrl, n) {
  const seen = new Set([norm(startUrl)]);
  const bySegment = new Map();
  for (const u of urls) {
    if (seen.has(norm(u))) continue;
    const seg = pathOf(u).split('/').filter(Boolean)[0] || '';
    if (!bySegment.has(seg)) bySegment.set(seg, []);
    bySegment.get(seg).push(u);
  }
  const picked = [];
  // round-robin across first path segments so we sample different page types
  while (picked.length < n - 1 && [...bySegment.values()].some((a) => a.length)) {
    for (const arr of bySegment.values()) {
      if (arr.length && picked.length < n - 1) picked.push(arr.shift());
    }
  }
  return picked;
}

export async function runUrlAudit(opts, c, log = () => {}) {
  const { allowLocal = false, maxPages = 6 } = opts;
  const net_ = { allowLocal };
  const start = new URL(opts.url).toString();

  // ---- 1. Start page ----
  log(`Fetching ${start}`);
  const first = await fetchUrl(start, { ...net_ });
  if (first.status === 401 || first.status === 403 || first.status === 451) {
    c.add('crawl.page-ok', 'skip', `HTTP ${first.status}: the server refused automated access (bot protection, login or a regional block). This audit does not try to bypass that, so nothing can be concluded about the site.`);
    return { aborted: true, meta: { url: start, error: `HTTP ${first.status} (automated access refused)` } };
  }
  if (first.status === 429 || first.status === 503) {
    c.add('crawl.page-ok', 'skip', `HTTP ${first.status}: the server rate-limited or refused the audit even after retrying. This says nothing about the site; try again later.`);
    return { aborted: true, meta: { url: start, error: `HTTP ${first.status} (rate-limited)` } };
  }
  if (first.error || first.status !== 200) {
    c.add('crawl.page-ok', 'fail', first.error ? first.error : `HTTP ${first.status} at ${first.finalUrl}`);
    return { aborted: true, meta: { url: start, error: first.error || `HTTP ${first.status}` } };
  }
  if (!isHtml(first)) {
    c.add('crawl.page-ok', 'skip', `The URL returns ${contentType(first) || 'unknown content'}, not an HTML page, so page checks do not apply.`);
    return { aborted: true, meta: { url: start, error: `not an HTML page (${contentType(first)})` } };
  }
  c.add('crawl.page-ok', 'pass', `HTTP 200 at ${first.finalUrl}`);
  const finalUrl = new URL(first.finalUrl);
  const origin = finalUrl.origin;
  const isLocalHost = finalUrl.hostname === 'localhost' || net.isIP(finalUrl.hostname) > 0 || finalUrl.hostname.endsWith('.localhost');

  c.add('crawl.redirect-chain', first.redirects.length <= 2 ? 'pass' : 'warn',
    first.redirects.length ? `${first.redirects.length} hop(s): ${first.redirects.map((r) => `${r.status}→${r.to}`).join(' ')}` : 'no redirects');

  // ---- 2. HTTPS and host canonicalisation ----
  if (isLocalHost) {
    c.add('crawl.https', 'skip', 'local host');
    c.add('crawl.single-host', 'skip', 'local host');
  } else {
    if (finalUrl.protocol !== 'https:') c.add('crawl.https', 'fail', `Final URL is ${finalUrl.protocol}`);
    else {
      const v = httpsVerdict(await fetchUrl(`http://${finalUrl.host}/`, { ...net_ }));
      c.add('crawl.https', v.status, v.evidence);
    }
    const h = finalUrl.hostname;
    const altHost = h.startsWith('www.') ? h.slice(4) : `www.${h}`;
    const alt = await fetchUrl(`${finalUrl.protocol}//${altHost}/`, { ...net_ });
    if (alt.error) c.add('crawl.single-host', 'pass', `${altHost} is not served (single host)`);
    else if (new URL(alt.finalUrl).hostname === h) c.add('crawl.single-host', 'pass', `${altHost} redirects to ${h}`);
    else if (new URL(alt.finalUrl).hostname === altHost && alt.status === 200) c.add('crawl.single-host', 'fail', `Both ${h} and ${altHost} serve content without redirecting`);
    else c.add('crawl.single-host', 'warn', `${altHost} ends at ${alt.finalUrl} (HTTP ${alt.status})`);
  }

  // ---- 3. robots.txt ----
  const robotsRes = await fetchUrl(`${origin}/robots.txt`, { ...net_ });
  const robotsOk = !robotsRes.error && robotsRes.status === 200 && !/<html/i.test(robotsRes.body.slice(0, 500));
  const robots = robotsOk ? parseRobots(robotsRes.body) : { groups: [], sitemaps: [] };
  c.add('crawl.robots-exists', robotsOk ? 'pass' : 'fail', robotsOk ? 'robots.txt found' : `HTTP ${robotsRes.status || robotsRes.error}`);
  if (robotsOk) {
    const blocksAll = !robotsAllows(robots, '*', '/');
    c.add('crawl.robots-open', blocksAll ? 'fail' : 'pass', blocksAll ? 'User-agent: * is disallowed from "/"' : 'homepage crawlable for *');
    c.add('crawl.robots-sitemap', robots.sitemaps.length ? 'pass' : 'warn', robots.sitemaps.length ? robots.sitemaps.join(', ') : 'no Sitemap: line');
  } else {
    c.add('crawl.robots-open', 'pass', 'no robots.txt = everything crawlable');
    c.add('crawl.robots-sitemap', 'fail', 'no robots.txt, so no Sitemap: line');
  }

  // ---- 4. sitemap ----
  const declared = robots.sitemaps.length > 0;
  const sitemapCandidates = declared ? robots.sitemaps : ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-index.xml'].map((p) => origin + p);
  let sitemapUrls = [];
  let sitemapEntries = [];
  let sitemapRaw = '';
  const sitemapErrors = [];
  let maxFileUrls = 0;   // the 50,000 URL / 50 MB limits apply to each sitemap FILE, not to the whole site
  let maxFileBytes = 0;
  for (const sm of sitemapCandidates.slice(0, declared ? 3 : 4)) {
    if (!declared && sitemapEntries.length) break; // common locations: stop at the first that works
    const r = await fetchUrl(sm, { ...net_, maxBytes: 10_000_000 });
    if (r.error || r.status !== 200) { sitemapErrors.push(`${sm}: ${r.error || 'HTTP ' + r.status}`); continue; }
    const parsed = parseSitemap(r.body);
    if (!parsed.valid) { sitemapErrors.push(`${sm}: not a valid sitemap XML`); continue; }
    sitemapRaw = r.body;
    let entries = parsed.entries;
    if (!parsed.isIndex) { maxFileUrls = Math.max(maxFileUrls, entries.length); maxFileBytes = Math.max(maxFileBytes, r.bytes); }
    if (parsed.isIndex) {
      const children = entries.slice(0, 5);
      entries = [];
      for (const ch of children) {
        const cr = await fetchUrl(ch.loc, { ...net_, maxBytes: 10_000_000 });
        if (!cr.error && cr.status === 200) {
          const childEntries = parseSitemap(cr.body).entries;
          maxFileUrls = Math.max(maxFileUrls, childEntries.length);
          maxFileBytes = Math.max(maxFileBytes, cr.bytes);
          for (const e of childEntries) entries.push(e);
        }
      }
    }
    c.add('crawl.sitemap-valid', entries.length ? 'pass' : 'warn', `${sm}: ${entries.length} URL(s)${parsed.isIndex ? ' (index)' : ''}`);
    for (const e of entries) sitemapEntries.push(e); // never spread: sitemaps can hold 100k+ URLs
  }
  sitemapUrls = sitemapEntries.map((e) => e.loc);
  const sitemapMissing = !sitemapEntries.length;
  if (sitemapMissing) c.items.delete('crawl.sitemap-valid'); // severity is decided below, once we know the site size

  if (sitemapEntries.length) {
    const problems = [];
    const soft = [];
    for (const e of sitemapEntries.slice(0, 2000)) {
      let u;
      try { u = new URL(e.loc); } catch { problems.push(`not absolute: ${e.loc}`); continue; }
      if (u.protocol !== 'https:' && !isLocalHost) problems.push(`not https: ${e.loc}`);
      if (u.hostname !== finalUrl.hostname) {
        // Google: a sitemap may only list URLs of its own host unless cross-submitted/verified.
        // A sibling subdomain is usually deliberate (soft); another domain is a real problem.
        (sameSite(u.hostname, finalUrl.hostname) ? soft : problems).push(`other host (${u.hostname}): ${e.loc}`);
      }
    }
    c.add('crawl.sitemap-limits', maxFileUrls <= 50000 && maxFileBytes <= 50_000_000 ? 'pass' : 'fail',
      `${sitemapEntries.length} URLs in total; largest single file: ${maxFileUrls} URLs, ${(maxFileBytes / 1e6).toFixed(2)} MB (limit per file: 50,000 URLs / 50 MB)`);
    const withMod = sitemapEntries.filter((e) => e.lastmod);
    if (withMod.length < 3) c.add('crawl.sitemap-lastmod', 'pass', withMod.length ? 'few lastmod values' : 'no lastmod (acceptable)');
    else {
      const minutes = new Set(withMod.map((e) => String(e.lastmod).slice(0, 16)));
      c.add('crawl.sitemap-lastmod', minutes.size === 1 ? 'warn' : 'pass',
        minutes.size === 1 ? `all ${withMod.length} URLs share lastmod ${[...minutes][0]} (build-time date?)` : `${minutes.size} distinct values`);
    }
    // verify a sample of URLs
    const check = sitemapEntries.slice(0, 12).map((e) => e.loc);
    const results = await pool(check, 4, async (u) => {
      let r = await fetchUrl(u, { ...net_, method: 'HEAD', follow: false });
      if (r.status === 405 || r.status === 501 || r.error) r = await fetchUrl(u, { ...net_, follow: false });
      return { u, status: r.status, loc: r.headers && r.headers.location, error: r.error };
    });
    for (const r of results) {
      if (r.error) problems.push(`${r.u}: ${r.error}`);
      else if (r.status >= 300 && r.status < 400) problems.push(`${r.u}: redirects (${r.status}) to ${r.loc}`);
      else if (r.status !== 200) problems.push(`${r.u}: HTTP ${r.status}`);
    }
    const all = [...problems, ...soft.slice(0, 3).map((x) => `${x} (sibling subdomain: valid only if verified together in Search Console)`)];
    c.add('crawl.sitemap-urls', problems.length ? 'fail' : soft.length ? 'warn' : 'pass', all.length ? all.slice(0, 5).join(' | ') : `${results.length} sampled URLs return 200 on the right host`);
  } else {
    c.add('crawl.sitemap-urls', 'skip', 'no sitemap URLs');
    c.add('crawl.sitemap-limits', 'skip', 'no sitemap');
    c.add('crawl.sitemap-lastmod', 'skip', 'no sitemap');
  }

  // ---- 5. Fetch sampled pages (sitemap first; otherwise discover through internal links) ----
  const firstParsed = parseHtml(first.body);
  let pool_ = sitemapUrls.filter((u) => { try { return new URL(u).hostname === finalUrl.hostname; } catch { return false; } });
  let discovered = false;
  if (!pool_.length) {
    discovered = true;
    const seenLinks = new Set();
    for (const a of firstParsed.anchors) {
      if (!a.href || /^(#|javascript:|mailto:|tel:)/i.test(a.href)) continue;
      try {
        const u = new URL(a.href, first.finalUrl);
        if (u.hostname !== finalUrl.hostname || !/^https?:$/.test(u.protocol)) continue;
        if (/\.(png|jpe?g|webp|svg|gif|pdf|zip|mp4|ico|css|js|xml|txt)$/i.test(u.pathname)) continue;
        u.hash = ''; u.search = '';
        seenLinks.add(u.toString());
      } catch { /* ignore */ }
    }
    pool_ = [...seenLinks];
  }
  if (sitemapMissing) {
    // Google: a small, well-linked site may not strictly need a sitemap. Large ones do.
    const large = pool_.length > 50;
    c.add('crawl.sitemap-valid', large ? 'fail' : 'warn', `no readable sitemap${sitemapErrors.length ? ` (${sitemapErrors.join('; ')}; a server that blocks automated clients can look like a missing sitemap)` : ''}; ${pool_.length} internal link(s) discovered on the homepage${large ? ' (a sitemap is strongly advised at this size)' : ' (small site: lower priority)'}`);
  }
  const sample = pickSample(pool_, first.finalUrl, maxPages);
  const pageUrls = [first.finalUrl, ...sample];
  log(`Auditing ${pageUrls.length} page(s)${discovered ? ' (discovered through internal links, no sitemap)' : ''}`);
  const pages = await pool(pageUrls, 2, async (u, i) => {
    const res = i === 0 ? first : await fetchUrl(u, { ...net_ });
    return { url: u, res, parsed: res.body && isHtml(res) ? parseHtml(res.body) : null, isHome: i === 0 };
  });

  const titles = new Map();
  const descs = new Map();
  for (const p of pages) {
    const scope = pages.length > 1 ? pathOf(p.url) || '/' : '';
    if (p.res.status === 200 && !isHtml(p.res)) { c.add('crawl.page-ok', 'skip', `not an HTML page (${contentType(p.res)}); page checks skipped`, scope); continue; }
    if (!p.parsed || p.res.status !== 200) {
      if (!p.isHome) {
        const limited = p.res.status === 429 || p.res.status === 503;
        const refused = p.res.status === 401 || p.res.status === 403 || p.res.status === 451;
        c.add('crawl.page-ok', limited || refused ? 'skip' : 'fail',
          limited ? `HTTP ${p.res.status}: server rate-limited the audit (not a site error); re-run later or with --pages 3`
            : refused ? `HTTP ${p.res.status}: automated access refused (bot protection or login); not evaluated`
              : `HTTP ${p.res.status || p.res.error}`, scope);
      }
      continue;
    }
    if (!p.isHome) c.add('crawl.page-ok', 'pass', 'HTTP 200', scope);
    pageChecks(p, scope, c);
    if (p.parsed.title) titles.set(p.parsed.title, [...(titles.get(p.parsed.title) || []), scope || '/']);
    if (p.parsed.description) descs.set(p.parsed.description, [...(descs.get(p.parsed.description) || []), scope || '/']);
  }
  if (pages.length > 1) {
    const dupT = [...titles.entries()].filter(([, v]) => v.length > 1);
    c.add('meta.title-unique', dupT.length ? 'fail' : 'pass', dupT.length ? dupT.map(([t, v]) => `"${t.slice(0, 60)}" on ${v.join(', ')}`).join(' | ') : `${titles.size} distinct titles`);
    const dupD = [...descs.entries()].filter(([, v]) => v.length > 1);
    c.add('meta.description-unique', dupD.length ? 'fail' : 'pass', dupD.length ? dupD.map(([, v]) => v.join(', ')).join(' | ') : `${descs.size} distinct descriptions`);
  } else {
    c.add('meta.title-unique', 'skip', 'only one page sampled (no sitemap)');
    c.add('meta.description-unique', 'skip', 'only one page sampled (no sitemap)');
  }

  const home = pages[0];
  if (home.parsed) homeChecks(home, pages, sitemapUrls, c, robots, robotsOk);

  // ---- 5b. Site health: sample internal links from the audited pages and check their status ----
  await checkInternalLinks(pages, finalUrl, net_, c);

  // ---- 6. Social images ----
  const imgUrls = [...new Set(pages.filter((p) => p.parsed && p.parsed.og['og:image']).map((p) => new URL(p.parsed.og['og:image'], p.url).toString()))].slice(0, 4);
  if (!imgUrls.length) {
    c.add('social.og-image', 'fail', 'no og:image on any sampled page');
    c.add('social.og-image-size', 'skip', 'no og:image');
  }
  for (const iu of imgUrls) {
    const r = await fetchUrl(iu, { ...net_, binary: true, maxBytes: 8_000_000 });
    const ct = String((r.headers && r.headers['content-type']) || '');
    const raw = pages.map((p) => p.parsed && p.parsed.og['og:image']).find((v) => v && new URL(v, pages[0].url).toString() === iu);
    if (/localhost|127\.0\.0\.1/.test(iu) && !isLocalHost) c.add('social.og-image', 'fail', `og:image points to localhost: ${iu}`);
    else if (r.error || r.status !== 200) c.add('social.og-image', 'fail', `${iu}: ${r.error || 'HTTP ' + r.status}`);
    else if (!ct.startsWith('image/')) c.add('social.og-image', 'fail', `${iu}: content-type ${ct || 'unknown'}`);
    else {
      c.add('social.og-image', raw && !/^https?:\/\//.test(raw) ? 'warn' : 'pass', raw && !/^https?:\/\//.test(raw) ? `relative og:image "${raw}" (works only with metadataBase)` : `${iu} OK`);
      const dims = imageSize(r.body);
      const kb = Math.round(r.bytes / 1024);
      const problems = [];
      if (dims) {
        const ratio = dims.width / dims.height;
        if (Math.abs(ratio - 1.91) > 0.2) problems.push(`${dims.width}×${dims.height} (ratio ${ratio.toFixed(2)}; 1.91:1 ≈ 1200×630 or 16:9 work best)`);
        if (dims.width < 600) problems.push(`narrow image (${dims.width}px)`);
      }
      if (r.bytes > 5_000_000 || r.truncated) problems.push(`${kb} KB is too heavy`);
      c.add('social.og-image-size', problems.length ? 'warn' : 'pass', problems.length ? `${iu.split('/').pop()}: ${problems.join('; ')}` : `${dims ? dims.width + '×' + dims.height : 'size unknown'}, ${kb} KB`);
    }
  }

  // ---- 7. Soft 404 ----
  const probe = `${origin}/__rg-seo-geo-skill-${Math.random().toString(36).slice(2, 8)}`;
  const nf = await fetchUrl(probe, { ...net_ });
  c.add('crawl.soft-404', nf.status === 404 || nf.status === 410 ? 'pass' : 'fail',
    nf.error ? nf.error : `Unknown URL returned HTTP ${nf.status}${nf.status === 200 ? ' (soft 404)' : ''}`);

  // ---- 8. AI bot access (GEO) ----
  if (robotsOk) {
    const blockedSearch = SEARCH_BOTS.filter((b) => !robotsAllows(robots, b, '/'));
    const blockedTraining = TRAINING_BOTS.filter((b) => !robotsAllows(robots, b, '/'));
    const note = `training bots blocked (a policy choice): ${blockedTraining.join(', ') || 'none'}`;
    c.add('geo.search-bots', blockedSearch.length ? 'warn' : 'pass', blockedSearch.length ? `search/answer bots blocked in robots.txt: ${blockedSearch.join(', ')} (publishers often do this on purpose; if not intended, you cannot be cited by them). ${note}` : `search/answer bots allowed. ${note}`);
  } else {
    c.add('geo.search-bots', 'pass', 'no robots.txt, so all bots allowed');
  }
  const baseline = first.status;
  const blockedUas = [];
  for (const [name, ua] of Object.entries(opts.localBuild ? {} : BOT_UAS)) {
    const r = await fetchUrl(first.finalUrl, { ...net_, ua, maxBytes: 200_000 });
    if (baseline === 200 && [401, 403, 429, 503].includes(r.status)) blockedUas.push(`${name}→${r.status}`);
  }
  if (opts.localBuild) c.add('geo.bot-access', 'skip', 'a local build has no CDN/WAF; check bot access on the deployed site');
  else c.add('geo.bot-access', blockedUas.length ? 'warn' : 'pass',
    blockedUas.length ? `${blockedUas.join(', ')} while a normal browser UA gets 200. Could be WAF impersonation protection (these requests come from a non-official IP); confirm in CDN logs.` : 'AI crawler user-agents receive the same 200 as browsers');
  const llms = await fetchUrl(`${origin}/llms.txt`, { ...net_, maxBytes: 200_000 });
  const hasLlms = llms.status === 200 && !/<html/i.test(llms.body.slice(0, 300));
  c.add('geo.llms-txt', 'info', hasLlms ? 'present (no proven effect)' : 'not present (no proven effect either way)');

  // ---- 9. Technology and JavaScript dependence (context for the report; no check depends on it) ----
  const notes = [];
  if (home.parsed) {
    if (looksLikeClientShell(home.parsed)) notes.push('client-shell');
  }
  const stack = detectStack(first.body, first.headers, home.parsed ? home.parsed.metaMap : {});

  return { aborted: false, meta: { url: start, finalUrl: first.finalUrl, origin, pages: pageUrls, sitemapUrlCount: sitemapUrls.length, discoveredPages: discovered, robotsFound: robotsOk, stack, notes, hasJsonLd: !!(home.parsed && home.parsed.jsonLd.length), hasSitemap: !sitemapMissing } };
}

function pageChecks(p, scope, c) {
  const { parsed: d, res } = p;
  const pageUrl = res.finalUrl;

  // noindex
  const xrt = String(res.headers['x-robots-tag'] || '').toLowerCase();
  const directives = `${d.robotsMeta},${d.googlebotMeta},${xrt}`;
  const noindex = /(^|[,\s])(noindex|none)([,\s]|$)/.test(directives);
  const noindexEvidence = noindex ? `noindex found (${directives.replace(/^,+|,+$/g, '')})` : 'indexable';
  if (p.isHome) c.add('crawl.not-noindex', noindex ? 'fail' : 'pass', noindexEvidence, scope);
  else c.add('crawl.sitemap-noindex', noindex ? 'fail' : 'pass', noindex ? `${noindexEvidence} but listed in the sitemap` : noindexEvidence, scope);
  const nosnippet = /nosnippet|max-snippet:\s*0\b/.test(directives);
  c.add('geo.snippet-controls', nosnippet ? 'fail' : 'pass', nosnippet ? `snippet limited (${directives})` : 'no snippet limits', scope);

  // canonical
  if (!d.canonical) c.add('crawl.canonical', 'warn', 'no canonical link (recommended: a self-referencing canonical)', scope);
  else {
    const abs = /^https?:\/\//i.test(d.canonical);
    const resolved = new URL(d.canonical, pageUrl).toString();
    if (norm(resolved) !== norm(pageUrl)) {
      const toHome = new URL(resolved).pathname === '/' && new URL(pageUrl).pathname !== '/';
      c.add('crawl.canonical', toHome ? 'fail' : 'warn',
        toHome ? `canonical points to the HOMEPAGE (${resolved}) although this is ${pageUrl}: tells Google this page duplicates the home`
          : `canonical ${resolved} ≠ page ${pageUrl} (intentional consolidation?)`, scope);
    } else c.add('crawl.canonical', abs ? 'pass' : 'warn', abs ? 'self-referencing' : `relative canonical "${d.canonical}"`, scope);
  }

  // title / description / h1 / lang / viewport
  if (!d.title) c.add('meta.title', 'fail', 'missing', scope);
  else {
    c.add('meta.title', 'pass', d.title.slice(0, 80), scope);
    const n = [...d.title].length;
    c.add('meta.title-length', n >= 15 && n <= 60 ? 'pass' : 'warn', `${n} chars`, scope);
  }
  if (!d.description) c.add('meta.description', p.isHome ? 'fail' : 'warn', 'missing', scope);
  else {
    const dn = [...d.description].length;
    c.add('meta.description', dn >= 50 && dn <= 170 ? 'pass' : 'warn', `${dn} chars${dn < 50 ? ' (too short to be useful)' : dn > 170 ? ' (likely truncated in results)' : ''}`, scope);
  }
  const h1s = d.headings.filter((h) => h.level === 1);
  c.add('meta.h1', h1s.length === 0 ? 'fail' : h1s.length > 1 ? 'warn' : 'pass', h1s.length === 1 ? h1s[0].text.slice(0, 70) : `${h1s.length} H1 elements`, scope);
  c.add('meta.lang', d.lang ? 'pass' : 'fail', d.lang ? `lang="${d.lang}"` : 'missing', scope);
  c.add('meta.viewport', !d.viewport ? 'fail' : /width\s*=\s*device-width/.test(d.viewport) ? 'pass' : 'warn', d.viewport || 'missing', scope);

  // Open Graph
  const missingCore = ['og:title', 'og:description'].filter((k) => !d.og[k]);
  const missingNice = ['og:url', 'og:type'].filter((k) => !d.og[k]);
  c.add('social.og-basics', missingCore.length ? 'fail' : missingNice.length ? 'warn' : 'pass', missingCore.length || missingNice.length ? `missing: ${[...missingCore, ...missingNice].join(', ')}` : 'complete', scope);
  c.add('social.twitter-card', d.og['twitter:card'] ? 'pass' : 'warn', d.og['twitter:card'] || 'missing', scope);

  // Content
  const wc = d.wordCount;
  const shell = looksLikeClientShell(d);
  c.add('content.server-rendered', wc >= 100 ? 'pass' : shell ? 'fail' : 'warn',
    `${wc} words in the initial HTML${shell ? ' and an empty app container: content is likely added by JavaScript' : wc < 100 ? ' (short page)' : ''}`, scope);
  const imgs = d.images.filter((i) => !(i.src || '').startsWith('data:'));
  const noAlt = imgs.filter((i) => i.alt === undefined);
  c.add('content.img-alt', !imgs.length || !noAlt.length ? 'pass' : noAlt.length / imgs.length > 0.2 ? 'fail' : 'warn', imgs.length ? `${noAlt.length}/${imgs.length} images without alt attribute` : 'no images', scope);
  const host = new URL(pageUrl).hostname;
  const isInternal = (h) => { try { return sameSite(new URL(h, pageUrl).hostname, host); } catch { return false; } };
  const bad = d.anchors.filter((a) => a.href === undefined || a.href === '#' || /^javascript:/i.test(a.href));
  const internal = d.anchors.filter((a) => a.href && !/^(#|javascript:|mailto:|tel:)/i.test(a.href) && isInternal(a.href));
  c.add('content.links', internal.length === 0 && wc >= 30 ? 'fail' : bad.length ? 'warn' : 'pass', `${internal.length} internal link(s)${bad.length ? `, ${bad.length} non-crawlable <a>` : ''}`, scope);
  const skips = [];
  for (let i = 1; i < d.headings.length; i++) if (d.headings[i].level > d.headings[i - 1].level + 1) skips.push(`h${d.headings[i - 1].level}→h${d.headings[i].level}`);
  c.add('content.headings', skips.length ? 'warn' : 'pass', skips.length ? `skips: ${[...new Set(skips)].join(', ')}` : 'ok', scope);

  // site health: mixed content and image dimensions
  if (new URL(pageUrl).protocol === 'https:') {
    const mixed = findMixedContent(d.resources, pageUrl);
    c.add('health.mixed-content', mixed.length ? 'fail' : 'pass', mixed.length ? `${mixed.length} http:// resource(s): ${mixed.slice(0, 3).map((m) => `${m.tag} ${m.url}`).join(', ')}` : 'no http:// subresources', scope);
  } else c.add('health.mixed-content', 'skip', 'page is not served over https (local build or plain-http site): check it again on the deployed site', scope);
  const dim = imageDimensionIssues(d.images);
  if (dim.total) c.add('health.img-dimensions', dim.missing === 0 ? 'pass' : dim.missing / dim.total > 0.3 ? 'warn' : 'pass', `${dim.missing}/${dim.total} images without width and height`, scope);

  // hreflang
  if (!d.hreflang.length) c.add('content.hreflang', 'skip', 'not used', scope);
  else {
    const self = d.hreflang.some((h) => norm(new URL(h.href, pageUrl).toString()) === norm(pageUrl));
    const badCodes = d.hreflang.filter((h) => !/^(x-default|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(h.lang));
    const xdef = d.hreflang.some((h) => h.lang === 'x-default');
    c.add('content.hreflang', !self || badCodes.length ? 'fail' : !xdef ? 'warn' : 'pass',
      [!self && 'no self-reference', badCodes.length && `invalid codes: ${badCodes.map((b) => b.lang).join(',')}`, !xdef && 'no x-default'].filter(Boolean).join('; ') || 'ok', scope);
  }

  // Structured data property completeness
  const problems = [];
  for (const b of d.jsonLd) for (const node of b.nodes) for (const t of types(node)) {
    const req = REQUIRED_PROPS[t];
    if (!req) continue;
    const missing = req.filter((k) => node[k] === undefined || node[k] === '');
    if (missing.length) problems.push(`${t}: missing ${missing.join(', ')}`);
  }
  if (d.jsonLd.length) c.add('schema.required', problems.length ? 'warn' : 'pass', problems.length ? problems.join('; ') : 'key properties present', scope);

  // GEO: authorship/freshness (article-like pages only)
  const nodeTypes = d.jsonLd.flatMap((b) => b.nodes.flatMap(types));
  const articleLike = nodeTypes.some((t) => /Article|BlogPosting|NewsArticle/.test(t)) || /\/(blog|articles?|news|posts?|insights|journal)\//i.test(new URL(pageUrl).pathname);
  if (articleLike) {
    const nodes = d.jsonLd.flatMap((b) => b.nodes);
    const hasAuthor = nodes.some((n) => n.author) || !!d.metaMap.author;
    const hasDate = nodes.some((n) => n.datePublished || n.dateModified) || d.timeTags > 0 || !!d.metaMap['article:published_time'];
    c.add('geo.freshness-author', hasAuthor && hasDate ? 'pass' : 'warn', `author: ${hasAuthor ? 'yes' : 'no'}, date: ${hasDate ? 'yes' : 'no'}`, scope);
  }

  // GEO: extractable structure (heuristic; needs enough text to judge)
  if (wc >= 100) {
    const q = /(\?\s*$)|^(how|what|why|when|who|which|can|do|does|is|are|cómo|qué|por qué|cuándo|cuánto|quién|cuál)\b/i;
    const questionHeadings = d.headings.filter((h) => h.level >= 2 && q.test(h.text)).length;
    const numbers = (d.text.match(/\b\d[\d.,%]*\b/g) || []).length;
    const signals = [d.listCount + d.tableCount > 0, questionHeadings > 0, numbers >= 5].filter(Boolean).length;
    c.add('geo.extractable', signals >= 2 ? 'pass' : 'warn', `lists/tables: ${d.listCount + d.tableCount}, question headings: ${questionHeadings}, figures: ${numbers}`, scope);
  }
}

function homeChecks(home, pages, sitemapUrls, c, robots, robotsOk) {
  const d = home.parsed;
  // icons
  c.add('social.icons', d.icons.length ? 'pass' : 'fail', d.icons.length ? `${d.icons.length} icon link(s)` : 'no <link rel="icon">');

  // JSON-LD
  if (!d.jsonLd.length) {
    c.add('schema.present', 'fail', 'no JSON-LD on the homepage');
  } else {
    const invalid = d.jsonLd.filter((b) => !b.ok);
    const noType = d.jsonLd.filter((b) => b.ok && !b.nodes.length);
    const noCtx = d.jsonLd.filter((b) => b.ok && !b.hasContext);
    c.add('schema.present', 'pass', `${d.jsonLd.length} block(s): ${[...new Set(d.jsonLd.flatMap((b) => b.nodes.flatMap(types)))].join(', ') || '—'}`);
    c.add('schema.valid', invalid.length ? 'fail' : noType.length || noCtx.length ? 'warn' : 'pass',
      invalid.length ? `invalid JSON: ${invalid[0].error}` : noType.length ? 'a block has no @type' : noCtx.length ? 'a block has no schema.org @context' : 'valid');
    const nodes = d.jsonLd.flatMap((b) => b.nodes);
    const entity = nodes.find((n) => types(n).some((t) => /^(Organization|Person|LocalBusiness|Corporation|ProfessionalService|Store|WebSite)$/.test(t)));
    c.add('schema.entity', entity ? 'pass' : 'warn', entity ? `declares ${types(entity).join(',')}` : 'no Organization / Person / WebSite node');
    const org = nodes.find((n) => types(n).some((t) => /^(Organization|Person|LocalBusiness|Corporation|ProfessionalService)$/.test(t)));
    if (org) {
      const sa = [].concat(org.sameAs || []).length;
      c.add('geo.entity', sa >= 2 ? 'pass' : 'warn', `${sa} sameAs link(s)`);
    } else c.add('geo.entity', 'skip', 'no entity node');
  }

  // who is behind the site
  const trust = trustSignals(d.anchors);
  const missingTrust = ['about', 'contact', 'privacy'].filter((k) => !trust[k]);
  c.add('geo.trust-pages', missingTrust.length === 0 ? 'pass' : 'warn', missingTrust.length ? `no link to: ${missingTrust.join(', ')}` : 'about, contact and privacy are linked');

  // Internal links present on the homepage but missing from the sitemap
  if (sitemapUrls.length) {
    const inSitemap = new Set(sitemapUrls.map(norm));
    const host = new URL(home.url).hostname;
    const linked = new Set();
    for (const a of d.anchors) {
      if (!a.href || /^(#|javascript:|mailto:|tel:)/i.test(a.href)) continue;
      try {
        const u = new URL(a.href, home.url);
        if (u.hostname !== host || /\.(png|jpe?g|webp|svg|pdf|zip|mp4|ico)$/i.test(u.pathname)) continue;
        u.search = '';
        linked.add(norm(u.toString()));
      } catch { /* ignore */ }
    }
    const missing = [...linked].filter((u) => !inSitemap.has(u));
    c.add('crawl.sitemap-has-page', missing.length ? 'warn' : 'pass', missing.length ? `${missing.length} linked page(s) not in sitemap: ${missing.slice(0, 5).map(pathOf).join(', ')}` : 'all internal links on the homepage are in the sitemap');
  } else c.add('crawl.sitemap-has-page', 'skip', 'no sitemap');
}

/**
 * Sample internal links (same host) from the audited pages and check them with HEAD (GET fallback),
 * without following redirects, so 404/410 (broken) and 3xx (redirected) can be told apart.
 * Pages already fetched are skipped. Links the server refuses (401/403/429) are not evaluated.
 */
async function checkInternalLinks(pages, finalUrl, net_, c) {
  const MAX = 40;
  const fetched = new Set(pages.map((p) => norm(p.url)));
  const queues = [];
  for (const p of pages) {
    if (!p.parsed) continue;
    const seen = new Set();
    const q = [];
    for (const a of p.parsed.anchors) {
      if (!a.href || /^(#|javascript:|mailto:|tel:|data:)/i.test(a.href)) continue;
      let u;
      try { u = new URL(a.href, p.res.finalUrl); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || u.hostname !== finalUrl.hostname) continue;
      u.hash = '';
      const key = norm(u.toString());
      if (fetched.has(key) || seen.has(key)) continue;
      seen.add(key);
      q.push({ url: u.toString(), from: pathOf(p.url) || '/' });
    }
    queues.push(q);
  }
  // round-robin across pages so one link-heavy page cannot use the whole budget
  const picked = [];
  const seenAll = new Set();
  while (picked.length < MAX && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && picked.length < MAX && !seenAll.has(norm(next.url))) { seenAll.add(norm(next.url)); picked.push(next); }
    }
  }
  if (!picked.length) { c.add('health.broken-links', 'skip', 'no internal links to check'); c.add('health.redirected-links', 'skip', 'no internal links to check'); return; }

  const results = await pool(picked, 3, async (l) => {
    let r = await fetchUrl(l.url, { ...net_, method: 'HEAD', follow: false, timeout: 8000, maxBytes: 50_000 });
    if (r.status === 405 || r.status === 501 || r.status === 400 || r.error) r = await fetchUrl(l.url, { ...net_, follow: false, timeout: 8000, maxBytes: 50_000 });
    return { ...l, status: r.status, error: r.error };
  });
  const where = (r) => `${pathOf(r.url) || '/'} (linked from ${r.from})`;
  const broken = results.filter((r) => r.status === 404 || r.status === 410 || (r.error && !r.status));
  const serverErr = results.filter((r) => r.status >= 500 && r.status < 600 && r.status !== 503);
  const redirected = results.filter((r) => r.status >= 300 && r.status < 400);
  const refused = results.filter((r) => [401, 403, 429, 503].includes(r.status));
  const checked = results.length - refused.length;
  c.add('health.broken-links', broken.length ? 'fail' : serverErr.length ? 'warn' : checked ? 'pass' : 'skip',
    broken.length ? broken.slice(0, 6).map((r) => `${r.status || r.error}: ${where(r)}`).join(' | ')
      : serverErr.length ? serverErr.slice(0, 6).map((r) => `${r.status}: ${where(r)}`).join(' | ')
        : `${checked} sampled link(s) OK${refused.length ? `; ${refused.length} refused automated access (not evaluated)` : ''}`);
  c.add('health.redirected-links', redirected.length ? 'warn' : checked ? 'pass' : 'skip',
    redirected.length ? redirected.slice(0, 6).map((r) => `${r.status}: ${where(r)}`).join(' | ') : 'no redirected internal links in the sample');
}
