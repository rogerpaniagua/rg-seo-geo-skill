// Source mode: static checks on a Next.js App Router project. Regex-based on purpose
// (zero dependencies). It reads files, never executes project code. Results are reliable
// for the common conventions; unusual setups may produce a "skip" or a false positive,
// which is why every finding carries file evidence.

import fs from 'node:fs';
import path from 'node:path';
import { sanitize } from './collector.mjs';

const IGNORE = new Set(['node_modules', '.next', '.git', '.vercel', 'dist', 'build', 'out', 'coverage']);
const CODE = /\.(tsx|ts|jsx|js|mjs)$/;

function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.isSymbolicLink()) continue;   // never follow symlinks out of the project
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function read(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 600_000) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

// Linear-time comment stripper. (The regex form /\/\*[\s\S]*?\*\// is quadratic on many unclosed "/*".)
// "//" after ":" is kept so URLs survive.
function stripComments(s) {
  let out = '';
  let last = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 47 && s.charCodeAt(i + 1) === 42) {                 // /* ... */
      const e = s.indexOf('*/', i + 2);
      out += s.slice(last, i) + ' ';
      if (e === -1) return out;                                    // unterminated: the rest is comment
      i = last = e + 2;
    } else if (c === 47 && s.charCodeAt(i + 1) === 47 && s.charCodeAt(i - 1) !== 58) {   // // line comment, not "://"
      out += s.slice(last, i);
      const nl = s.indexOf('\n', i);
      if (nl === -1) return out;
      i = last = nl;
    } else i++;
  }
  return out + s.slice(last);
}
// Linear scan over leading whitespace and comments, then check for the directive.
function isUseClient(src) {
  let j = 0;
  const n = src.length;
  for (;;) {
    while (j < n && /\s/.test(src[j])) j++;
    if (src.startsWith('/*', j)) { const e = src.indexOf('*/', j + 2); if (e === -1) return false; j = e + 2; continue; }
    if (src.startsWith('//', j)) { const e = src.indexOf('\n', j); if (e === -1) return false; j = e + 1; continue; }
    break;
  }
  return src.startsWith("'use client'", j) || src.startsWith('"use client"', j);
}
const exportsMetadata = (src) => /export\s+(?:const|let|async\s+function|function)\s+(?:metadata|generateMetadata)\b|export\s*\{[^}]{0,500}\b(?:metadata|generateMetadata)\b/.test(src);
const hasNoindex = (src) => /index\s*:\s*false|noindex/.test(src);

function routeOf(appDir, file) {
  const rel = path.relative(appDir, path.dirname(file)).split(path.sep).filter(Boolean);
  const segs = rel.filter((s) => !/^\(.*\)$/.test(s));
  return { route: '/' + segs.join('/'), dynamic: segs.some((s) => s.includes('[')), parallel: segs.some((s) => s.startsWith('@') || s.startsWith('(.')) };
}

export function runNextAudit(opts, c, log = () => {}) {
  const root = path.resolve(opts.src);
  const meta = { src: sanitize(path.basename(root), 80), framework: null };
  if (!fs.existsSync(root)) throw new Error(`Source directory not found: ${root}`);

  let pkg = {};
  try { pkg = JSON.parse(read(path.join(root, 'package.json'))); } catch { /* none */ }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) {
    meta.note = 'No "next" dependency in package.json. Source mode currently supports Next.js (App Router). Use URL mode for this project.';
    return { skipped: true, meta };
  }
  // The version string comes from the audited project's package.json: validate it, never echo it raw.
  meta.framework = `Next.js ${typeof deps.next === 'string' && /^[\w.^~<>=* |-]{1,30}$/.test(deps.next) ? deps.next : '(unrecognised version)'}`;

  const appDir = ['app', 'src/app'].map((d) => path.join(root, d)).find((d) => { try { const st = fs.lstatSync(d); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } });
  if (!appDir) {
    meta.note = 'No app/ directory found (Pages Router?). Source mode supports the App Router only. Use URL mode.';
    return { skipped: true, meta };
  }
  meta.appDir = path.relative(root, appDir);
  log(`Next.js App Router detected in ${meta.appDir}`);

  const all = walk(appDir);
  const rel = (f) => path.relative(root, f);
  const byBase = (re) => all.filter((f) => re.test(path.basename(f)));
  const text = new Map();
  const src = (f) => { if (!text.has(f)) text.set(f, stripComments(read(f))); return text.get(f); };

  const pages = byBase(/^page\.(tsx|ts|jsx|js)$/).filter((f) => !routeOf(appDir, f).parallel);
  const layouts = byBase(/^layout\.(tsx|ts|jsx|js)$/);
  const rootLayout = layouts.find((f) => path.dirname(f) === appDir);
  const rootSrc = rootLayout ? src(rootLayout) : '';
  const multi = pages.length > 1;

  // ancestors' layouts (excluding root) for a page file
  const chain = (file) => layouts.filter((l) => l !== rootLayout && path.dirname(file).startsWith(path.dirname(l)));

  // ---- metadataBase / root metadata ----
  if (!rootLayout) {
    c.add('next.metadata-base', 'fail', 'no root layout found');
    c.add('next.root-metadata', 'fail', 'no root layout found');
  } else {
    c.add('next.metadata-base', /metadataBase\s*:/.test(rootSrc) ? 'pass' : 'fail', /metadataBase\s*:/.test(rootSrc) ? rel(rootLayout) : `missing in ${rel(rootLayout)}`);
    const hasMeta = exportsMetadata(rootSrc);
    const hasTitle = /\btitle\s*:/.test(rootSrc);
    const hasDesc = /\bdescription\s*:/.test(rootSrc);
    const hasTemplate = /template\s*:/.test(rootSrc);
    if (!hasMeta || !hasTitle || !hasDesc) c.add('next.root-metadata', 'fail', `${rel(rootLayout)}: ${[!hasMeta && 'no metadata export', !hasTitle && 'no title', !hasDesc && 'no description'].filter(Boolean).join(', ')}`);
    else c.add('next.root-metadata', hasTemplate || !multi ? 'pass' : 'warn', hasTemplate ? 'title template present' : multi ? 'no title.template (pages need to repeat the brand suffix)' : 'ok');
  }

  // ---- Open Graph / social ----
  const ogFiles = byBase(/^(opengraph-image|twitter-image)\.(jpg|jpeg|png|gif|tsx|ts|js)$/);
  const hasOgMeta = /openGraph\s*:/.test(rootSrc) || pages.some((p) => /openGraph\s*:/.test(src(p)));
  if (hasOgMeta || ogFiles.length) {
    const hasImage = ogFiles.length || /images\s*:/.test(rootSrc);
    c.add('next.social', hasImage ? 'pass' : 'warn', hasImage ? [hasOgMeta && 'openGraph metadata', ogFiles.length && `${ogFiles.length} image file(s)`].filter(Boolean).join(' + ') : 'openGraph set but no image');
  } else c.add('next.social', 'fail', 'no openGraph metadata and no opengraph-image file');

  // ---- canonical ----
  const rootCanonical = /canonical\s*:/.test(rootSrc);
  const rootPage = pages.find((p) => routeOf(appDir, p).route === '/');
  const nonRoot = pages.filter((p) => p !== rootPage);
  const missingCanonical = nonRoot.filter((p) => !/canonical\s*:/.test(src(p)) && !chain(p).some((l) => /canonical\s*:/.test(src(l))));
  if (!rootCanonical && !pages.some((p) => /canonical\s*:/.test(src(p)))) c.add('next.canonical', 'fail', 'alternates.canonical not set anywhere');
  else if (rootCanonical && missingCanonical.length) {
    c.add('next.canonical', 'fail', `canonical is set in the root layout, so these pages inherit the HOME canonical: ${missingCanonical.slice(0, 5).map((p) => routeOf(appDir, p).route).join(', ')}${missingCanonical.length > 5 ? ` … +${missingCanonical.length - 5}` : ''}`);
  } else if (missingCanonical.length) {
    c.add('next.canonical', 'warn', `no canonical on: ${missingCanonical.slice(0, 5).map((p) => routeOf(appDir, p).route).join(', ')}`);
  } else c.add('next.canonical', 'pass', 'every page defines or inherits a page-specific canonical');

  // ---- sitemap / robots ----
  const sitemapFile = byBase(/^sitemap\.(ts|js|xml)$/).find((f) => path.dirname(f) === appDir) || byBase(/^sitemap\.(ts|js|xml)$/)[0];
  const nextSitemapPkg = !!deps['next-sitemap'];
  const publicSitemap = fs.existsSync(path.join(root, 'public', 'sitemap.xml'));
  c.add('next.sitemap-file', sitemapFile || nextSitemapPkg || publicSitemap ? 'pass' : 'fail', sitemapFile ? rel(sitemapFile) : nextSitemapPkg ? 'next-sitemap package' : publicSitemap ? 'public/sitemap.xml' : 'none found');
  const robotsFile = byBase(/^robots\.(ts|js|txt)$/)[0];
  const publicRobots = fs.existsSync(path.join(root, 'public', 'robots.txt'));
  c.add('next.robots-file', robotsFile || publicRobots ? 'pass' : 'fail', robotsFile ? rel(robotsFile) : publicRobots ? 'public/robots.txt' : 'none found');

  // ---- sitemap coverage + lastmod ----
  if (sitemapFile && /\.(ts|js)$/.test(sitemapFile)) {
    const sm = read(sitemapFile);
    const literal = (sm.match(/https?:\/\/[^'"`\s)]+/g) || []);
    const dynamicSitemap = /\.map\(|fetch\(|await\s|generateSitemaps|from\s+['"]@?\/?[^'"]*(cases|posts|data|db)/.test(sm);
    const staticRoutes = pages
      .map((p) => ({ p, ...routeOf(appDir, p) }))
      .filter((r) => !r.dynamic && !/^\/(api|admin|dashboard|login|signup|auth|preview|draft)(\/|$)/.test(r.route) && !hasNoindex(src(r.p)));
    if (!literal.length && dynamicSitemap && !/^\s*url\s*:/m.test(sm)) {
      c.add('next.sitemap-coverage', 'skip', 'sitemap is data-driven; verify the generated /sitemap.xml with URL mode');
    } else {
      const missing = staticRoutes.filter((r) => {
        if (r.route === '/') return !(literal.length || /url\s*:/.test(sm));
        const esc = r.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp(`${esc}/?(?=['"\`])`).test(sm);
      });
      c.add('next.sitemap-coverage', missing.length ? 'fail' : 'pass', missing.length ? `routes not in ${rel(sitemapFile)}: ${missing.map((r) => r.route).join(', ')}` : `${staticRoutes.length} static route(s) all present`);
    }
    const stamped = (sm.match(/lastModified\s*:\s*new Date\(\s*\)/g) || []).length;
    c.add('next.sitemap-lastmod', stamped >= 2 ? 'warn' : 'pass', stamped >= 2 ? `${stamped} URLs use lastModified: new Date() (changes every build)` : 'no build-time stamping');
  } else {
    c.add('next.sitemap-coverage', 'skip', 'no sitemap.ts/js to inspect');
    c.add('next.sitemap-lastmod', 'skip', 'no sitemap.ts/js to inspect');
  }

  // ---- host consistency ----
  const hosts = new Map();
  const note = (label, s) => { for (const h of (s.match(/https?:\/\/[^/'"`\s)]+/g) || [])) { const host = h.replace(/^https?:\/\//, '').toLowerCase(); if (!/^(localhost|127\.|schema\.org|www\.w3\.org|nextjs\.org|vercel\.com|fonts\.)/.test(host)) { if (!hosts.has(host)) hosts.set(host, new Set()); hosts.get(host).add(label); } } };
  const baseMatch = rootSrc.match(/metadataBase\s*:\s*new URL\(\s*['"`]([^'"`]+)['"`]/);
  if (baseMatch) note('metadataBase', baseMatch[1]);
  for (const f of [rootLayout, ...pages].filter(Boolean)) {
    for (const m of src(f).matchAll(/canonical\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/g)) note('canonical', m[1]);
  }
  if (sitemapFile) note('sitemap', read(sitemapFile).replace(/schema\.org|sitemaps\.org/g, ''));
  if (robotsFile) note('robots', read(robotsFile));
  const mainHosts = [...hosts.entries()].filter(([, labels]) => [...labels].some((l) => ['metadataBase', 'canonical', 'sitemap', 'robots'].includes(l)));
  const distinct = new Set(mainHosts.map(([h]) => h));
  if (distinct.size > 1) c.add('next.host-consistency', 'fail', mainHosts.map(([h, l]) => `${h} (${[...l].join(', ')})`).join(' vs '));
  else if (distinct.size === 1) c.add('next.host-consistency', 'pass', `${[...distinct][0]} everywhere`);
  else c.add('next.host-consistency', 'skip', 'site URL comes from env vars; check in URL mode');

  // ---- per-page metadata ----
  const dynamicPages = pages.map((p) => ({ p, ...routeOf(appDir, p) })).filter((r) => r.dynamic);
  if (dynamicPages.length) {
    const missing = dynamicPages.filter((r) => !/generateMetadata/.test(src(r.p)) && !chain(r.p).some((l) => /generateMetadata/.test(src(l))));
    c.add('next.dynamic-metadata', missing.length ? 'fail' : 'pass', missing.length ? `no generateMetadata: ${missing.map((r) => r.route).join(', ')}` : `${dynamicPages.length} dynamic route(s) covered`);
  } else c.add('next.dynamic-metadata', 'skip', 'no dynamic routes');

  const staticPages = pages.map((p) => ({ p, ...routeOf(appDir, p) })).filter((r) => !r.dynamic && r.route !== '/');
  if (staticPages.length) {
    const missing = staticPages.filter((r) => !exportsMetadata(src(r.p)) && !chain(r.p).some((l) => exportsMetadata(src(l))) && !hasNoindex(src(r.p)));
    c.add('next.page-metadata', missing.length ? 'fail' : 'pass', missing.length ? `inherits the root title/description: ${missing.map((r) => r.route).join(', ')}` : `${staticPages.length} page(s) define metadata`);
  } else c.add('next.page-metadata', 'skip', 'single-page site');

  const clientPages = pages.filter((p) => isUseClient(read(p)));
  const clientInner = clientPages.filter((p) => p !== rootPage);
  const clientHomeOnly = clientPages.length > 0 && clientInner.length === 0;
  c.add('next.client-page', clientInner.length ? 'fail' : clientHomeOnly ? 'warn' : 'pass',
    clientInner.length ? `${clientInner.map((p) => rel(p)).join(', ')} cannot export metadata` : clientHomeOnly ? `${rel(rootPage)} is a Client Component; it inherits the layout metadata, but ships more JS than needed` : 'all pages are Server Components');

  // ---- assets & misc ----
  const iconFiles = byBase(/^(favicon\.ico|icon\d*\.(ico|png|jpg|svg|tsx|ts)|apple-icon\d*\.(png|jpg|tsx|ts))$/);
  const iconsMeta = /icons\s*:/.test(rootSrc) || /rel\s*=\s*["'](shortcut )?icon["']/.test(rootSrc);
  const publicFavicon = fs.existsSync(path.join(root, 'public', 'favicon.ico'));
  c.add('next.icons', iconFiles.length || iconsMeta || publicFavicon ? 'pass' : 'warn', iconFiles.length ? `${iconFiles.length} icon file(s)` : iconsMeta ? 'declared in layout' : publicFavicon ? 'public/favicon.ico' : 'none found');

  const codeFiles = [appDir, path.join(root, 'src'), path.join(root, 'components')]
    .filter((d, i, a) => fs.existsSync(d) && a.indexOf(d) === i)
    .flatMap((d) => walk(d))
    .filter((f) => CODE.test(f) && /\.(tsx|jsx)$/.test(f));
  const uniqueCode = [...new Set(codeFiles)];
  const jsonld = uniqueCode.some((f) => /application\/ld\+json/.test(read(f)));
  c.add('next.jsonld', jsonld ? 'pass' : 'warn', jsonld ? 'application/ld+json found' : 'no JSON-LD in the app');
  const imgFiles = uniqueCode.filter((f) => /<img\b/.test(stripComments(read(f))));
  c.add('next.img-tag', imgFiles.length ? 'warn' : 'pass', imgFiles.length ? `<img> in ${imgFiles.slice(0, 5).map(rel).join(', ')}${imgFiles.length > 5 ? ` … +${imgFiles.length - 5}` : ''}` : 'no raw <img>');
  c.add('next.not-found', byBase(/^not-found\.(tsx|ts|jsx|js)$/).length ? 'pass' : 'warn', 'app/not-found');

  meta.routes = pages.map((p) => routeOf(appDir, p).route);
  return { skipped: false, meta };
}
