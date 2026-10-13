// Client-rendered single-page apps (Vite, Create React App, Vue CLI, Angular CLI, Parcel...).
// The server sends one HTML shell (index.html) for every route and JavaScript fills it in. Google renders
// JavaScript, though it may defer it; AI crawlers are reported (third-party measurements) not to run it.

import path from 'node:path';
import { read, relPath, headFacts, evalHead, evalRobotsOpen, evidenceList, hasDep } from './common.mjs';

const UI = /^(react|react-dom|vue|svelte|preact|solid-js|@angular\/core|lit)$/;
// Frameworks that render on the server themselves; they are not "plain SPAs".
const SERVER_RENDERED = /^(next|nuxt|nuxt3|astro|@sveltejs\/kit|@remix-run\/(node|react|serve|dev)|@react-router\/(dev|node|serve)|gatsby|vike|vite-plugin-ssr|@tanstack\/(react-)?start|solid-start|@solidjs\/start|@builder\.io\/qwik-city|@11ty\/eleventy|vitepress|@docusaurus\/core|@angular\/ssr)$/;
const PRERENDER = /^(vite-ssg|vite-plugin-prerender|@prerenderer\/.+|prerender-spa-plugin|react-snap|react-snap-fork|vike|vite-plugin-ssr|@angular\/platform-server|@angular\/ssr|@vue\/server-renderer|vue-server-renderer|rsbuild-plugin-prerender|vite-react-ssg|vite-plugin-ssr)$/;
const ROUTER = /^(react-router|react-router-dom|vue-router|@angular\/router|wouter|@tanstack\/react-router|svelte-routing|svelte-spa-router|preact-router|navigo|page|@reach\/router)$/;
const HEAD_MANAGER = /^(react-helmet|react-helmet-async|@dr\.pogodin\/react-helmet|@unhead\/react|@unhead\/vue|@vueuse\/head|vue-meta|svelte-meta-tags|react-head)$/;
const ENTRIES = ['index.html', 'public/index.html', 'src/index.html'];

export function detectSpa(root, deps, files) {
  if (!hasDep(deps, UI) || hasDep(deps, SERVER_RENDERED)) return false;
  return ENTRIES.some((e) => files.some((f) => relPath(root, f) === e));
}

export function auditSpa({ root, deps, files }, c) {
  const rel = (f) => relPath(root, f);
  const entry = ENTRIES.map((e) => files.find((f) => rel(f) === e)).find(Boolean);
  const entryRel = rel(entry);
  const hasRouter = hasDep(deps, ROUTER);
  const prerender = Object.keys(deps).filter((n) => PRERENDER.test(n));
  const headManager = hasDep(deps, HEAD_MANAGER) || files.some((f) => /\.(ts|tsx|js|jsx)$/.test(f) && rel(f).startsWith('src/') && /\.setTitle\s*\(/.test(read(f, 200_000)));

  // --- rendering ---
  if (prerender.length) c.add('src.rendering', 'pass', `prerendering/SSR tooling present (${prerender.join(', ')}): confirm the build actually emits one HTML file per route`);
  else c.add('src.rendering', 'fail',
    `Client-rendered single-page app: every route is served the same ${entryRel} shell and JavaScript fills it in. Google renders JavaScript but may defer it; AI crawlers are reported not to run it at all, so they can see an empty page. Add prerendering or server rendering (e.g. vite-ssg, vike), or move to a framework such as Astro or Next.js.`);

  // --- head tags: only the shell exists, so every route shares it ---
  const facts = headFacts([{ file: entryRel, text: read(entry) }]);
  evalHead(c, facts, { hint: {
    head: `Add them in ${entryRel}.`,
    canonical: `Remove it from ${entryRel}: a canonical in the shared shell is the same for every route. Set it per route with a head manager, or prerender.`,
    social: `Add Open Graph tags (note: social scrapers do not run JavaScript, so tags added at runtime are not seen).`,
    jsonld: `Add JSON-LD in ${entryRel} or per route.`,
  } });

  // --- per-route titles ---
  if (!hasRouter) c.add('src.page-metadata', 'pass', `no client-side router: ${entryRel} is the only page`);
  else if (!headManager) c.add('src.page-metadata', 'fail', `the app has client-side routes but no head manager (react-helmet-async, @unhead/*, vue-meta...), so every route shares the title and description of ${entryRel}`);
  else c.add('src.page-metadata', prerender.length ? 'pass' : 'warn', prerender.length ? 'head manager plus prerendering' : 'a head manager sets titles at runtime, in the browser: crawlers that do not run JavaScript still see only the shell');

  // --- sitemap / robots ---
  const sitemapFile = files.find((f) => /^(public\/)?sitemap[^/]*\.xml$/.test(rel(f)));
  c.add('src.sitemap', sitemapFile || hasDep(deps, /sitemap/) ? 'pass' : 'fail', sitemapFile ? rel(sitemapFile) : hasDep(deps, /sitemap/) ? 'sitemap package' : 'no sitemap. Add public/sitemap.xml (or generate it at build time)');
  const robotsFile = files.find((f) => /^(public\/)?robots\.txt$/.test(rel(f)));
  if (robotsFile) { c.add('src.robots', 'pass', rel(robotsFile)); evalRobotsOpen(c, read(robotsFile), rel(robotsFile)); }
  else c.add('src.robots', 'fail', 'no robots.txt. Add public/robots.txt (with a Sitemap: line)');
  c.add('src.site-url', 'skip', 'not applicable to a plain SPA');
  return { routes: hasRouter ? 'client-side' : 1 };
}
