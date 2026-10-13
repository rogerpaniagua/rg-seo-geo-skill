// Astro: file-based routing in src/pages, layouts in src/layouts, `site` in astro.config.
// Verified against the Astro docs: the sitemap integration needs `site`; robots.txt lives in public/
// (or an endpoint at src/pages/robots.txt.ts).

import fs from 'node:fs';
import path from 'node:path';
import { read, relPath, headFacts, evalHead, evalRobotsOpen, evidenceList, stripJsComments, pageMetaStatus } from './common.mjs';

const CONFIGS = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.cjs'];

export function detectAstro(root, deps) {
  // A package that only depends on `astro` (an integration, a component library) is not a site.
  return CONFIGS.some((f) => fs.existsSync(path.join(root, f))) || ('astro' in deps && fs.existsSync(path.join(root, 'src', 'pages')));
}

export function auditAstro({ root, deps, files }, c) {
  const rel = (f) => relPath(root, f);
  const configFile = CONFIGS.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  const config = configFile ? stripJsComments(read(configFile)) : '';
  const inSrc = files.filter((f) => rel(f).startsWith('src/'));
  const astroFiles = inSrc.filter((f) => f.endsWith('.astro'));
  // In Astro, files and folders prefixed with "_" under src/pages are not routes (components, helpers)
  const isRoute = (f) => !rel(f).replace(/^src\/pages\//, '').split('/').some((seg) => seg.startsWith('_'));
  const pages = inSrc.filter((f) => /^src\/pages\//.test(rel(f)) && /\.(astro|md|mdx|html)$/.test(f) && !/(^|\/)404\.\w+$/.test(rel(f)) && isRoute(f));
  const endpoints = inSrc.filter((f) => /^src\/pages\//.test(rel(f)) && /\.(ts|js)$/.test(f));
  const publicHas = (re) => files.find((f) => re.test(rel(f)));

  // --- site URL ---
  // `site` is often an expression (`site: process.env.X || 'https://...'`), so only the key is required
  const hasSite = /(^|[\s{,])site\s*:/.test(config);
  const sitemapIntegration = '@astrojs/sitemap' in deps || /@astrojs\/sitemap|\bsitemap\s*\(/.test(config);
  if (hasSite) c.add('src.site-url', 'pass', `site configured in ${configFile ? rel(configFile) : 'astro.config'}`);
  else c.add('src.site-url', sitemapIntegration ? 'fail' : 'warn',
    `no \`site\` in ${configFile ? rel(configFile) : 'astro.config.mjs (not found)'}. ${sitemapIntegration ? 'The sitemap integration needs it to build. ' : ''}Add: site: 'https://your-domain.com'`);

  // --- sitemap ---
  const sitemapFile = publicHas(/^public\/sitemap[^/]*\.xml$/) || endpoints.find((f) => /sitemap[^/]*\.xml\.(ts|js)$/.test(f));
  if (sitemapIntegration) c.add('src.sitemap', 'pass', '@astrojs/sitemap integration');
  else if (sitemapFile) c.add('src.sitemap', 'pass', rel(sitemapFile));
  else c.add('src.sitemap', 'fail', 'no sitemap integration or file. Run: npx astro add sitemap (and set `site`)');

  // --- robots ---
  const robotsStatic = files.find((f) => rel(f) === 'public/robots.txt');
  const robotsEndpoint = endpoints.find((f) => /robots\.txt\.(ts|js)$/.test(f));
  if (robotsStatic) { c.add('src.robots', 'pass', 'public/robots.txt'); evalRobotsOpen(c, read(robotsStatic), 'public/robots.txt'); }
  else if (robotsEndpoint) c.add('src.robots', 'pass', rel(robotsEndpoint));
  else c.add('src.robots', 'fail', 'no robots.txt. Add public/robots.txt (with a Sitemap: line) or src/pages/robots.txt.ts');

  // --- head tags, canonical, social, JSON-LD, noindex ---
  const facts = headFacts(astroFiles.slice(0, 400).map((f) => ({ file: rel(f), text: read(f) })));
  evalHead(c, facts, { hint: {
    head: 'Put <title>, <meta name="description">, viewport and <html lang> in your base layout (src/layouts).',
    canonical: 'Build it per page: <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site)} />',
    social: 'Add og:title, og:description, og:image to the base layout.',
    jsonld: 'Add a <script type="application/ld+json"> in the layout.',
  } });

  // --- every page names itself ---
  const missing = [];
  for (const p of pages) {
    const text = read(p);
    // named: sets a title, passes title/description props, or spreads props ({...meta}) into the layout
    const named = /<title[\s>]|<head[\s>]|\btitle\s*=|\btitle\s*:|<[A-Z]\w*[^>]{0,300}\{\.\.\./.test(text);
    const route = rel(p).replace(/^src\/pages\//, '/').replace(/(index)?\.(astro|md|mdx|html)$/, '') || '/';
    // the home page commonly relies on the layout's default title; only other pages must name themselves
    if (!named && route !== '/') missing.push(route);
  }
  if (!pages.length) c.add('src.page-metadata', 'skip', 'no pages found under src/pages');
  else c.add('src.page-metadata', pageMetaStatus(missing, pages.length), missing.length ? `no title passed or set in: ${evidenceList(missing)}. Pass title and description props to your layout.` : `${pages.length} page(s) set their own title (or inherit the layout default on the home page)`);

  // --- content that only exists after JavaScript ---
  const clientOnly = astroFiles.filter((f) => read(f).includes('client:only')).map(rel);
  c.add('src.rendering', clientOnly.length ? 'warn' : 'pass',
    clientOnly.length ? `client:only components render in the browser only, so their content is not in the HTML (${evidenceList(clientOnly)}). Prefer client:load / client:visible for content that matters for SEO.` : 'no client:only islands: content is rendered into the HTML');

  // --- images, 404 ---
  const rawImg = astroFiles.filter((f) => /<img[\s>]/i.test(read(f))).map(rel);
  c.add('src.images', rawImg.length ? 'warn' : 'pass', rawImg.length ? `raw <img> in ${evidenceList(rawImg)}. Astro's <Image /> (astro:assets) sizes and optimises images.` : 'no raw <img> in .astro files');
  const notFound = pages.concat(inSrc.filter((f) => /^src\/pages\/404\./.test(rel(f)))).find((f) => /(^|\/)404\.\w+$/.test(rel(f)));
  c.add('src.not-found', notFound ? 'pass' : 'warn', notFound ? rel(notFound) : 'no src/pages/404.astro: add one so unknown URLs return a helpful page with a real 404 status');

  return { routes: pages.length };
}
