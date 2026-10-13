// Best-effort technology detection from the raw HTML and headers. It is only used to label the
// report and to point to the right place to fix things; no check depends on it.

const SIGNALS = [
  ['WordPress', (h, html, gen) => /wordpress/i.test(gen) || /\/wp-(content|includes)\//i.test(html)],
  ['Shopify', (h, html) => /cdn\.shopify\.com|Shopify\.theme/i.test(html) || !!h['x-shopid']],
  ['Wix', (h, html, gen) => /wix\.com/i.test(gen) || /static\.wixstatic\.com|x-wix-/i.test(html + Object.keys(h).join(' '))],
  ['Squarespace', (h, html, gen) => /squarespace/i.test(gen) || /static1\.squarespace\.com/i.test(html)],
  ['Webflow', (h, html, gen) => /webflow/i.test(gen) || /data-wf-(page|site)/i.test(html)],
  ['Framer', (h, html, gen) => /framer/i.test(gen) || /framerusercontent\.com/i.test(html)],
  ['Next.js', (h, html) => /\/_next\/|__NEXT_DATA__/.test(html) || /next\.js/i.test(String(h['x-powered-by'] || ''))],
  ['Nuxt', (h, html) => /\/_nuxt\/|__NUXT__/.test(html)],
  ['Astro', (h, html, gen) => /astro/i.test(gen) || /astro-island|data-astro-cid/.test(html)],
  ['Gatsby', (h, html, gen) => /gatsby/i.test(gen) || /___gatsby/.test(html)],
  ['SvelteKit', (h, html) => /__sveltekit|data-sveltekit/.test(html)],
  ['Remix', (h, html) => /__remixContext/.test(html)],
  ['Angular', (h, html) => /ng-version=/.test(html)],
  ['Drupal', (h, html, gen) => /drupal/i.test(gen)],
  ['Ghost', (h, html, gen) => /ghost/i.test(gen)],
  ['Hugo / Jekyll', (h, html, gen) => /^(hugo|jekyll)/i.test(gen)],
];

export function detectStack(html, headers = {}, metaMap = {}) {
  const gen = String(metaMap.generator || '');
  for (const [name, test] of SIGNALS) {
    try { if (test(headers, html, gen)) return name; } catch { /* ignore */ }
  }
  return null;
}

/** Where to fix things, per stack. Plain language, used in the report header. */
export const STACK_HINTS = {
  WordPress: { en: 'Titles, descriptions, canonical, sitemap and schema are usually managed by an SEO plugin (Yoast SEO, Rank Math, SEOPress).', es: 'Títulos, descripciones, canonical, sitemap y schema normalmente los gestiona un plugin de SEO (Yoast SEO, Rank Math, SEOPress).' },
  Shopify: { en: 'Edit titles and descriptions per page/product in the admin (SEO section); theme-level tags live in theme.liquid. Sitemap is automatic.', es: 'Edita títulos y descripciones por página/producto en el admin (sección SEO); las etiquetas globales están en theme.liquid. El sitemap es automático.' },
  Wix: { en: 'Use the SEO tools in the Wix editor (page SEO settings, Site Inspection).', es: 'Usa las herramientas SEO del editor de Wix (ajustes SEO de página, inspección del sitio).' },
  Squarespace: { en: 'Use Page Settings → SEO and the site-wide SEO panel.', es: 'Usa Ajustes de página → SEO y el panel SEO del sitio.' },
  Webflow: { en: 'Use Page Settings → SEO and Open Graph, and Site Settings → SEO for sitemap and robots.', es: 'Usa Ajustes de página → SEO y Open Graph, y Ajustes del sitio → SEO para sitemap y robots.' },
  Framer: { en: 'Use Page settings → SEO and Site settings for sitemap and robots.', es: 'Usa Ajustes de página → SEO y Ajustes del sitio para sitemap y robots.' },
  'Next.js': { en: 'Pass --src with the project folder for code-level findings and fixes (see references/nextjs-fixes.md).', es: 'Pasa --src con la carpeta del proyecto para hallazgos y correcciones a nivel de código (ver references/nextjs-fixes.md).' },
  Nuxt: { en: 'Use useSeoMeta/useHead in pages and the @nuxtjs/sitemap and @nuxtjs/robots modules.', es: 'Usa useSeoMeta/useHead en las páginas y los módulos @nuxtjs/sitemap y @nuxtjs/robots.' },
  Astro: { en: 'Set <head> tags in your layout and use the @astrojs/sitemap integration.', es: 'Define las etiquetas del <head> en tu layout y usa la integración @astrojs/sitemap.' },
  Gatsby: { en: 'Use gatsby-plugin-sitemap and the Gatsby Head API.', es: 'Usa gatsby-plugin-sitemap y la Head API de Gatsby.' },
  SvelteKit: { en: 'Use <svelte:head> in routes and generate sitemap.xml with a +server route.', es: 'Usa <svelte:head> en las rutas y genera sitemap.xml con una ruta +server.' },
  Remix: { en: 'Use the meta and links exports per route and a resource route for sitemap.xml.', es: 'Usa los exports meta y links por ruta y una ruta de recurso para sitemap.xml.' },
};

/**
 * A "client-rendered shell": almost no text in the first HTML plus an empty app container.
 * Metadata and content may be added by JavaScript, which this audit does not run.
 */
export function looksLikeClientShell(html, wordCount) {
  return wordCount < 30 && /<div[^>]+id=["'](root|app|__nuxt|___gatsby)["'][^>]*>\s*<\/div>|<noscript>[^<]*(enable|habilit)[^<]*javascript/i.test(html);
}
