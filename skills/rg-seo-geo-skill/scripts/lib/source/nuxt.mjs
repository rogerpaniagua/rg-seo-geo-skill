// Nuxt. Verified against the Nuxt docs: `ssr` defaults to true and `ssr: false` generates pages with no
// content; useSeoMeta is the recommended way to set meta tags; Nuxt injects viewport and charset by default.

import fs from 'node:fs';
import path from 'node:path';
import { read, relPath, headFacts, evalHead, evalRobotsOpen, evidenceList, stripJsComments, hasDep, pageMetaStatus } from './common.mjs';

const CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'];

export function detectNuxt(root, deps) {
  const structure = ['pages', 'app/pages', 'app.vue', 'app/app.vue'].some((p) => fs.existsSync(path.join(root, p)));
  return CONFIGS.some((f) => fs.existsSync(path.join(root, f))) || (('nuxt' in deps || 'nuxt3' in deps) && structure);
}

export function auditNuxt({ root, deps, files }, c) {
  const rel = (f) => relPath(root, f);
  const configFile = CONFIGS.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  const config = configFile ? stripJsComments(read(configFile)) : '';
  const seoModule = hasDep(deps, /^(@nuxtjs\/seo|nuxt-seo-utils)$/) || /@nuxtjs\/seo|nuxt-seo-utils/.test(config);
  const sitemapModule = seoModule || hasDep(deps, /sitemap/) || /sitemap/.test(config);
  const robotsModule = seoModule || hasDep(deps, /robots/) || /robots/.test(config);
  const ogModule = seoModule || hasDep(deps, /og-image/) || /og-image/.test(config);
  const schemaModule = seoModule || hasDep(deps, /schema-org/) || /schema-org/.test(config);

  // Nuxt 3 keeps pages in pages/, Nuxt 4 in app/pages/
  const inDir = (dirs) => files.filter((f) => dirs.some((d) => rel(f).startsWith(d)));
  const pageFiles = inDir(['pages/', 'app/pages/']).filter((f) => f.endsWith('.vue'));
  const vueFiles = files.filter((f) => f.endsWith('.vue') && !/node_modules/.test(f));
  const appFiles = files.filter((f) => /^(app\/)?(app|error)\.vue$/.test(rel(f)) || /^(app\/)?layouts\//.test(rel(f)));
  const has = (re) => files.find((f) => re.test(rel(f)));

  // --- rendering ---
  const ssrOff = /\bssr\s*:\s*false\b/.test(config.replace(/routeRules[\s\S]{0,2000}/, ''));
  const routeSsrOff = /routeRules[\s\S]{0,2000}ssr\s*:\s*false/.test(config);
  if (ssrOff) c.add('src.rendering', 'fail', `${configFile ? rel(configFile) : 'nuxt.config'} sets ssr: false. Per the Nuxt docs, generated pages then have no content: search engines and AI crawlers receive an empty shell. Remove it, or prerender with nitro.prerender / routeRules.`);
  else if (routeSsrOff) c.add('src.rendering', 'warn', 'a routeRules entry sets ssr: false for some routes: those pages are client-rendered only');
  else c.add('src.rendering', 'pass', 'server-side rendering is on (Nuxt default)');

  // --- sitemap / robots ---
  const sitemapFile = has(/^(public\/sitemap[^/]*\.xml|server\/routes\/sitemap[^/]*\.(ts|js))$/);
  c.add('src.sitemap', sitemapModule || sitemapFile ? 'pass' : 'fail', sitemapModule ? 'sitemap module configured' : sitemapFile ? rel(sitemapFile) : 'no sitemap module or file. Add @nuxtjs/sitemap (or @nuxtjs/seo) and set site.url');
  const robotsFile = has(/^public\/robots\.txt$/);
  if (robotsFile) { c.add('src.robots', 'pass', 'public/robots.txt'); evalRobotsOpen(c, read(robotsFile), 'public/robots.txt'); }
  else c.add('src.robots', robotsModule ? 'pass' : 'fail', robotsModule ? 'robots module configured' : 'no robots.txt. Add public/robots.txt or the @nuxtjs/robots module');
  if (sitemapModule) {
    const hasSiteUrl = /\bsite\s*:\s*\{[^}]{0,300}url\s*:/.test(config) || /siteUrl|NUXT_(PUBLIC_)?SITE_URL/.test(config) || files.some((f) => /^\.env/.test(path.basename(f)) && /SITE_URL/.test(read(f, 20_000)));
    c.add('src.site-url', hasSiteUrl ? 'pass' : 'warn', hasSiteUrl ? 'site URL configured' : 'the sitemap module needs the site URL: set site: { url: "https://your-domain.com" } in nuxt.config (or the NUXT_SITE_URL environment variable, which this review cannot see)');
  } else c.add('src.site-url', 'skip', 'only needed when a sitemap/SEO module is used');

  // --- head tags ---
  // Defaults can live in nuxt.config (app.head) or in app.vue / layouts through useHead / useSeoMeta.
  const defaultsText = [config, ...appFiles.map((f) => read(f))].join('\n');
  const facts = headFacts([]);
  const fileLabel = configFile ? rel(configFile) : 'nuxt.config';
  const tok = (re) => re.test(defaultsText);
  if (tok(/\btitle\s*:|titleTemplate|useSeoMeta\(\s*\{[^}]{0,300}title/)) facts.title.push(fileLabel);
  if (tok(/name\s*:\s*['"]description['"]|\bdescription\s*:/)) facts.description.push(fileLabel);
  if (tok(/\blang\s*:|htmlAttrs/)) facts.lang.push(fileLabel);
  if (tok(/ogTitle|ogImage|og:title|og:image/) || ogModule) facts.og.push(fileLabel);
  if (tok(/twitterCard|twitter:card/)) facts.twitter.push(fileLabel);
  if (tok(/application\/ld\+json|useSchemaOrg|defineWebSite|defineOrganization/) || schemaModule) facts.jsonld.push(fileLabel);
  // canonical: a literal href set globally (app.head.link) applies to every page
  const lit = /rel\s*:\s*['"]canonical['"][^}]{0,200}href\s*:\s*['"](https?:\/\/[^'"{}$]+)['"]|href\s*:\s*['"](https?:\/\/[^'"{}$]+)['"][^}]{0,200}rel\s*:\s*['"]canonical['"]/.exec(config);
  if (lit) facts.canonicalLiteral.push({ file: fileLabel, href: lit[1] || lit[2] });
  else if (seoModule || /canonical/.test(defaultsText) || vueFiles.some((f) => /canonical/.test(read(f)))) facts.canonical.push(seoModule ? '@nuxtjs/seo' : fileLabel);
  for (const f of vueFiles.slice(0, 300)) {
    const t = read(f);
    if (/ogTitle|ogImage|og:title/.test(t) && !facts.og.length) facts.og.push(rel(f));
    if (t.includes('application/ld+json') && !facts.jsonld.length) facts.jsonld.push(rel(f));
  }
  evalHead(c, facts, { viewportInjected: true, hint: {
    head: 'Set defaults in nuxt.config (app.head: title, titleTemplate, htmlAttrs.lang, meta description) or in app.vue with useHead / useSeoMeta.',
    canonical: 'Build it per page, e.g. with the @nuxtjs/seo module, instead of a fixed href in nuxt.config.',
    social: 'Use useSeoMeta({ ogTitle, ogDescription, ogImage }) in pages or app.vue.',
    jsonld: 'Use the nuxt-schema-org module or add a ld+json script with useHead.',
  } });

  // --- every page names itself (useSeoMeta is the recommended API) ---
  // Application screens (admin, dashboard, auth...) and parent routes that only render <NuxtPage/> are not public content pages.
  const NON_PUBLIC = /^\/(admin|dashboard|login|logout|signin|signup|auth|account|settings|api|preview|draft)(\/|$)/;
  const routeOf = (f) => relPath(root, f).replace(/^(app\/)?pages\//, '/').replace(/(index)?\.vue$/, '') || '/';
  const contentPages = pageFiles.filter((f) => !NON_PUBLIC.test(routeOf(f)) && !/<(NuxtPage|RouterView)[\s/>]/.test(read(f)));
  const missing = contentPages.filter((f) => !/useSeoMeta\s*\(|useHead\s*\(|definePageMeta\s*\(\s*\{[^}]{0,300}title/.test(read(f))).map(routeOf);
  if (!contentPages.length) c.add('src.page-metadata', 'skip', 'no content pages under pages/ (single app.vue, custom routing, or only application screens)');
  else c.add('src.page-metadata', pageMetaStatus(missing, contentPages.length), missing.length ? `no useSeoMeta/useHead in: ${evidenceList(missing)}` : `${contentPages.length} page(s) set their own title/description`);

  // --- images, 404 ---
  const rawImg = vueFiles.filter((f) => /<img[\s>]/i.test(read(f))).map(rel);
  c.add('src.images', rawImg.length && !hasDep(deps, /^@nuxt\/image$/) ? 'warn' : 'pass', rawImg.length && !hasDep(deps, /^@nuxt\/image$/) ? `raw <img> in ${evidenceList(rawImg)}. @nuxt/image (<NuxtImg>) optimises and sizes images.` : 'images handled');
  c.add('src.not-found', has(/^(app\/)?error\.vue$/) ? 'pass' : 'warn', has(/^(app\/)?error\.vue$/) ? 'error.vue' : 'no error.vue: add one to customise 404/500 pages');
  return { routes: pageFiles.length };
}
