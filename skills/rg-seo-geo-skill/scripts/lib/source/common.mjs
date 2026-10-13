// Shared building blocks for source-code review of any framework.
//
// Source mode reads files; it never runs project code. Everything here is defensive because the
// project may be a clone of a stranger's repository: symlinks are never followed, files are size
// capped, the walk is bounded, and scanning is linear (no regex over file contents that can backtrack).

import fs from 'node:fs';
import path from 'node:path';
import { parseHtml, parseRobots, robotsAllows } from '../html.mjs';
import { sanitize } from '../collector.mjs';

export const IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.vercel', '.cache', '.turbo',
  'dist', 'build', 'out', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', 'storage', 'tmp', 'target', '_site', 'public_html_cache',
]);

const MAX_FILES = 20000;
const MAX_DEPTH = 14;
const MAX_READ = 600_000;

// Files that can never matter for SEO review. A real project can hold tens of thousands of images, and counting them
// would exhaust the file budget before the config and public/ folders are even reached.
const HEAVY = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|svg|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|map|psd|ai|sketch|fig|lock|log|mdx?|json5?)$/i;
const KEEP_HEAVY = /(^|\/)(package\.json|composer\.json|tsconfig\.json|theme\.json|manifest\.json|[^/]*sitemap[^/]*\.xml)$/i;

/**
 * Bounded listing, breadth-first (so top-level config and public/ are always reached before deep content trees),
 * skipping ignored folders, heavy assets and symlinks.
 */
export function walk(root) {
  const files = [];
  const queue = [[root, 0]];
  for (let qi = 0; qi < queue.length && files.length < MAX_FILES; qi++) {
    const [dir, depth] = queue[qi];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE.has(e.name) && depth < MAX_DEPTH) queue.push([full, depth + 1]); }
      else if (e.isFile()) { if (!HEAVY.test(e.name) || KEEP_HEAVY.test(e.name)) files.push(full); }
    }
  }
  return files;
}

/** Text of a regular file, or '' (too big, unreadable, symlink). */
export function read(file, max = MAX_READ) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > max) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

/** First `bytes` of a regular file (a 100 KB style.css must still be readable for its header). */
export function readHead(file, bytes = 4096) {
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return '';
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(bytes, st.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

export function readJson(file) {
  try { return JSON.parse(read(file)); } catch { return null; }
}

export const relPath = (root, f) => path.relative(root, f).split(path.sep).join('/');

/** A version string from someone else's package.json: shown only if it looks like a version. */
export function versionLabel(v) {
  return typeof v === 'string' && /^[\w.^~<>=* |-]{1,30}$/.test(v) ? v : '(unrecognised version)';
}

/** "Astro ^5.0.0", or just "Astro" when the version is a workspace:/catalog: reference or anything unrecognisable. */
export function withVersion(name, v) {
  return typeof v === 'string' && /^[\w.^~<>=* |-]{1,30}$/.test(v) && !/^(workspace|catalog|link|file|npm|git)/i.test(v) ? `${name} ${v}` : name;
}

export function allDeps(pkg) {
  const out = {};
  if (!pkg || typeof pkg !== 'object') return out;
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (pkg[k] && typeof pkg[k] === 'object') for (const [n, v] of Object.entries(pkg[k])) if (!(n in out)) out[n] = v;
  }
  return out;
}

export const hasDep = (deps, re) => Object.keys(deps).some((n) => re.test(n));

/** Linear removal of /* ... *\/ and // comments, keeping "://" so URLs survive. */
export function stripJsComments(s) {
  let out = '';
  let last = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 47 && s.charCodeAt(i + 1) === 42) {
      const e = s.indexOf('*/', i + 2);
      out += s.slice(last, i) + ' ';
      if (e === -1) return out;
      i = last = e + 2;
    } else if (c === 47 && s.charCodeAt(i + 1) === 47 && s.charCodeAt(i - 1) !== 58) {
      out += s.slice(last, i);
      const nl = s.indexOf('\n', i);
      if (nl === -1) return out;
      i = last = nl;
    } else i++;
  }
  return out + s.slice(last);
}

/** Is this a plain URL with no template placeholders, i.e. identical on every page that uses it? */
export function isLiteralUrl(href) {
  if (typeof href !== 'string') return false;
  const h = href.trim();
  if (!/^https?:\/\//i.test(h) || h.length > 500) return false;
  for (const ch of h) if ('{}<>$@%'.includes(ch)) return false;
  return true;
}

// Tools that emit the head tags for you. Seeing one means the tags are provided even though the
// template does not spell them out.
const PROVIDERS = [
  { token: '{% seo', name: 'jekyll-seo-tag', gives: ['title', 'description', 'canonical', 'og', 'twitter', 'jsonld'] },
  { token: '{%- seo', name: 'jekyll-seo-tag', gives: ['title', 'description', 'canonical', 'og', 'twitter', 'jsonld'] },
  { token: '_internal/opengraph.html', name: 'Hugo opengraph template', gives: ['og'] },
  { token: '_internal/twitter_cards.html', name: 'Hugo twitter-cards template', gives: ['twitter'] },
  { token: '_internal/schema.html', name: 'Hugo schema template', gives: ['jsonld'] },
  { token: 'SEO::generate', name: 'artesaos/seotools', gives: ['title', 'description', 'canonical', 'og', 'twitter', 'jsonld'] },
  { token: 'SEOTools::', name: 'artesaos/seotools', gives: ['title', 'description', 'canonical', 'og', 'twitter', 'jsonld'] },
  { token: 'display_meta_tags', name: 'meta-tags (Rails)', gives: ['title', 'description', 'canonical', 'og', 'twitter'] },
  { token: 'wp_head(', name: 'wp_head() hook (SEO plugins output the tags)', gives: [] },
];

/**
 * Collect what a set of template/layout files provides for the document <head>.
 * `files` is [{ file, text }]; the result maps each capability to the files that provide it.
 */
export function headFacts(files) {
  const f = { title: [], description: [], viewport: [], lang: [], canonical: [], canonicalLiteral: [], og: [], twitter: [], jsonld: [], noindex: [], providers: new Map() };
  for (const { file, text } of files) {
    if (!text) continue;
    const p = parseHtml(text);
    if (p.title !== undefined) f.title.push(file);
    if (p.metaMap.description !== undefined) f.description.push(file);
    if (p.viewport !== undefined) f.viewport.push(file);
    if (p.lang !== undefined || /(language_attributes|getLocale|LANGUAGE_CODE|I18n\.locale|Language\.Lang|html_lang)/.test(text)) f.lang.push(file);
    if (p.canonical !== undefined) {
      f.canonical.push(file);
      if (isLiteralUrl(p.canonical)) f.canonicalLiteral.push({ file, href: p.canonical });
    }
    if (Object.keys(p.og).some((k) => k.startsWith('og:')) || /og:(title|image|description)|ogTitle|ogImage/.test(text)) f.og.push(file);
    if (p.og['twitter:card'] !== undefined || text.includes('twitter:card') || text.includes('twitterCard')) f.twitter.push(file);
    if (p.jsonLd.length || text.includes('application/ld+json')) f.jsonld.push(file);
    if (p.robotsMeta.includes('noindex')) f.noindex.push({ file, value: p.robotsMeta });
    for (const pr of PROVIDERS) {
      if (text.includes(pr.token)) {
        if (!f.providers.has(pr.name)) f.providers.set(pr.name, { file, gives: pr.gives });
        for (const g of pr.gives) if (!f[g].includes(file)) f[g].push(file);
      }
    }
  }
  return f;
}

const where = (list, max = 3) => list.slice(0, max).join(', ') + (list.length > max ? ` … +${list.length - max}` : '');

/**
 * The checks that read the same way in every framework: head essentials, canonical, social tags,
 * structured data and leftover noindex. `opts.hint` carries framework-specific remedies.
 */
export function evalHead(c, facts, opts = {}) {
  const h = opts.hint || {};
  const skipEssentials = opts.skipEssentials;
  const viewportOk = opts.viewportInjected || facts.viewport.length > 0;
  const missingCore = [!facts.title.length && 'title', !viewportOk && 'viewport meta'].filter(Boolean);
  const missingSoft = [!facts.description.length && 'meta description', !facts.lang.length && 'html lang'].filter(Boolean);
  const via = facts.providers.size ? ` (provided by ${[...facts.providers.keys()].join(', ')})` : '';
  if (skipEssentials) c.add('src.head-essentials', 'skip', skipEssentials);
  else if (missingCore.length) c.add('src.head-essentials', 'fail', `not found in any layout/template: ${[...missingCore, ...missingSoft].join(', ')}. ${h.head || ''}`);
  else if (missingSoft.length) c.add('src.head-essentials', 'warn', `not found in any layout/template: ${missingSoft.join(', ')}. ${h.head || ''}`);
  else c.add('src.head-essentials', 'pass', `title ${where(facts.title)}; description ${where(facts.description)}; lang and viewport present${via}`);

  if (facts.canonicalLiteral.length) {
    const x = facts.canonicalLiteral[0];
    c.add('src.canonical', 'fail', `${x.file} hardcodes the canonical ${x.href}: every page that uses it declares the SAME canonical, telling Google they all duplicate that one URL. ${h.canonical || ''}`);
  } else if (facts.canonical.length) c.add('src.canonical', 'pass', `canonical built per page in ${where(facts.canonical)}${via}`);
  else c.add('src.canonical', 'warn', `no canonical link found. ${h.canonical || ''}`);

  const og = facts.og.length, tw = facts.twitter.length;
  c.add('src.social', og ? 'pass' : 'warn', og ? `Open Graph in ${where(facts.og)}${tw ? '' : ' (no twitter:card; optional)'}` : `no Open Graph tags found: shared links will have no preview. ${h.social || ''}`);

  c.add('src.jsonld', facts.jsonld.length ? 'pass' : 'warn', facts.jsonld.length ? `JSON-LD in ${where(facts.jsonld)}` : `no JSON-LD structured data found. ${h.jsonld || ''}`);

  if (facts.noindex.length) {
    const x = facts.noindex[0];
    const conditional = /[?{(]|if|env/i.test(x.value);
    c.add('src.noindex', 'warn', `${x.file} sets robots "${x.value.slice(0, 60)}"${conditional ? ' (looks conditional)' : ''}. Make sure it applies to staging only; a leftover noindex removes the site from Google.`);
  } else c.add('src.noindex', 'pass', 'no unconditional noindex found in layouts/templates');
}

/** A static robots.txt that disallows the whole site for every bot is the classic staging leftover. */
export function evalRobotsOpen(c, robotsText, file) {
  if (!robotsText) return;
  // A robots.txt written as a template (Hugo/Jinja/ERB/Blade/PHP) often has a staging branch ("Disallow: /") next to the
  // production one. Its text is not its output, so it cannot be judged without running the template.
  if (/\{\{|\{%|<%|<\?|@if\b|@php\b/.test(robotsText)) { c.add('src.robots-open', 'skip', `${file} is a template: its output cannot be evaluated statically. Check the live /robots.txt with the URL audit`); return; }
  const parsed = parseRobots(robotsText);
  const blocked = !robotsAllows(parsed, '*', '/');
  c.add('src.robots-open', blocked ? 'fail' : 'pass', blocked ? `${file}: User-agent * is disallowed from "/" (staging leftover?)` : `${file} allows crawling`);
}

/**
 * How serious are pages that do not set their own metadata? A missing home page, or a quarter of the site or more,
 * is a failure. A page or two (an app screen, a legal page) is only a warning.
 */
export function pageMetaStatus(missingRoutes, totalPages) {
  if (!missingRoutes.length) return 'pass';
  return missingRoutes.includes('/') || missingRoutes.length / Math.max(1, totalPages) >= 0.25 ? 'fail' : 'warn';
}

export const evidenceList = (items, max = 5) => items.slice(0, max).join(', ') + (items.length > max ? ` … +${items.length - max}` : '');
export { sanitize };
