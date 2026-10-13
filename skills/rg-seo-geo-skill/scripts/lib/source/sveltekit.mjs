// SvelteKit. Verified against the SvelteKit docs: SSR is on by default and `ssr = false` in the root
// layout makes the whole app client-only (not recommended); every page should have a unique <title> and
// <meta name="description"> inside <svelte:head>; a sitemap is a +server endpoint.

import fs from 'node:fs';
import path from 'node:path';
import { read, relPath, headFacts, evalHead, evalRobotsOpen, evidenceList, hasDep, pageMetaStatus } from './common.mjs';

export function detectSvelteKit(root, deps) {
  // Routes are what make it an app: a package that merely depends on @sveltejs/kit (types, adapters) is not one.
  return fs.existsSync(path.join(root, 'src', 'routes')) && ('@sveltejs/kit' in deps || fs.existsSync(path.join(root, 'svelte.config.js')));
}

export function auditSvelteKit({ root, deps, files }, c) {
  const rel = (f) => relPath(root, f);
  const routes = files.filter((f) => rel(f).startsWith('src/routes/'));
  const svelte = routes.filter((f) => f.endsWith('.svelte'));
  const pages = routes.filter((f) => /(^|\/)\+page\.svelte$/.test(rel(f)));
  const layouts = routes.filter((f) => /(^|\/)\+layout\.svelte$/.test(rel(f)));
  const has = (re) => files.find((f) => re.test(rel(f)));

  // --- rendering ---
  const ssrFalse = (f) => /export\s+const\s+ssr\s*=\s*false/.test(read(f));
  const optionFiles = routes.filter((f) => /(^|\/)\+(page|layout)(\.server)?\.(js|ts)$/.test(rel(f)));
  const rootOff = optionFiles.filter((f) => /^src\/routes\/\+layout(\.server)?\.(js|ts)$/.test(rel(f)) && ssrFalse(f));
  const someOff = optionFiles.filter((f) => ssrFalse(f) && !rootOff.includes(f));
  const cfg = read(path.join(root, 'svelte.config.js'));
  const spaFallback = /adapter-static/.test(cfg) && /\bfallback\s*:/.test(cfg);
  if (rootOff.length) c.add('src.rendering', 'fail', `${rel(rootOff[0])} sets ssr = false: the whole app becomes a single-page app and the server sends an empty shell. The SvelteKit docs advise against it.`);
  else if (spaFallback) c.add('src.rendering', 'warn', 'adapter-static with a `fallback` page builds a client-rendered SPA; prerender your routes (export const prerender = true) so the HTML contains the content');
  else if (someOff.length) c.add('src.rendering', 'warn', `ssr = false in ${evidenceList(someOff.map(rel))}: those routes are client-rendered only`);
  else c.add('src.rendering', 'pass', 'server-side rendering is on (SvelteKit default)');

  // --- sitemap / robots ---
  const sitemapRoute = has(/^src\/routes\/(.*\/)?sitemap[^/]*\.xml\/\+server\.(js|ts)$/) || has(/^static\/sitemap[^/]*\.xml$/);
  const sitemapDep = hasDep(deps, /sitemap/);
  c.add('src.sitemap', sitemapRoute || sitemapDep ? 'pass' : 'fail', sitemapRoute ? rel(sitemapRoute) : sitemapDep ? 'sitemap package' : 'no sitemap. Add src/routes/sitemap.xml/+server.ts returning XML with Content-Type application/xml');
  const robotsFile = has(/^static\/robots\.txt$/);
  if (robotsFile) { c.add('src.robots', 'pass', 'static/robots.txt'); evalRobotsOpen(c, read(robotsFile), 'static/robots.txt'); }
  else if (has(/^src\/routes\/robots\.txt\/\+server\.(js|ts)$/)) c.add('src.robots', 'pass', 'robots.txt endpoint');
  else c.add('src.robots', 'fail', 'no robots.txt. Add static/robots.txt (with a Sitemap: line)');
  c.add('src.site-url', 'skip', 'SvelteKit has no single site-URL setting; absolute URLs are built in your sitemap/canonical code');

  // --- head: src/app.html holds lang + viewport, routes hold the rest ---
  const appHtml = files.find((f) => rel(f) === 'src/app.html');
  const facts = headFacts([...(appHtml ? [{ file: 'src/app.html', text: read(appHtml) }] : []), ...svelte.slice(0, 400).map((f) => ({ file: rel(f), text: read(f) }))]);
  evalHead(c, facts, { hint: {
    head: 'Give every page a <title> and <meta name="description"> inside <svelte:head>; keep lang and viewport in src/app.html.',
    canonical: 'Build it per page in <svelte:head> from the page URL ($app/state page.url), not a fixed href.',
    social: 'Add og:title, og:description and og:image in <svelte:head>.',
    jsonld: 'Add a <script type="application/ld+json"> inside <svelte:head>.',
  } });

  // --- every page has a title: its own <svelte:head>, or an ancestor layout that fills it from page data ---
  const headTitle = (t) => /<svelte:head[\s>]/.test(t) && /<title[\s>]/.test(t);
  const layoutCovers = (page) => layouts.some((l) => path.dirname(page).startsWith(path.dirname(l)) && headTitle(read(l)));
  const missingTitle = [];
  const missingDesc = [];
  for (const p of pages) {
    const t = read(p);
    if (layoutCovers(p)) continue;
    const label = rel(p).replace(/^src\/routes/, '').replace(/\/?\+page\.svelte$/, '') || '/';
    if (!headTitle(t)) missingTitle.push(label);
    else if (!/<meta[^>]{0,200}name\s*=\s*["']description["']/.test(t)) missingDesc.push(label);
  }
  if (!pages.length) c.add('src.page-metadata', 'skip', 'no +page.svelte routes found');
  else if (missingTitle.length) c.add('src.page-metadata', pageMetaStatus(missingTitle, pages.length), `no <title> in <svelte:head> for: ${evidenceList(missingTitle)}. The SvelteKit docs: give every page a unique title and description.`);
  else if (missingDesc.length) c.add('src.page-metadata', 'warn', `no meta description in: ${evidenceList(missingDesc)}`);
  else c.add('src.page-metadata', 'pass', `${pages.length} page(s) covered by their own or a layout <svelte:head>`);

  // --- images, 404 ---
  const rawImg = svelte.filter((f) => /<img[\s>]/i.test(read(f))).map(rel);
  c.add('src.images', rawImg.length && !('@sveltejs/enhanced-img' in deps) ? 'warn' : 'pass', rawImg.length && !('@sveltejs/enhanced-img' in deps) ? `raw <img> in ${evidenceList(rawImg)}. @sveltejs/enhanced-img optimises and sizes images.` : 'images handled');
  c.add('src.not-found', has(/^src\/routes\/\+error\.svelte$/) ? 'pass' : 'warn', has(/^src\/routes\/\+error\.svelte$/) ? 'src/routes/+error.svelte' : 'no src/routes/+error.svelte: add one to customise the 404 page');
  return { routes: pages.length };
}
