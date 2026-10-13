// Single source of truth for the standard. Every check the audit can emit is defined here.
// The report, the CI exit code and the generated references/standard.md all read from this file.
//
// tier     blocker   = breaks indexing or sharing. Must be fixed before launch.
//          important = hurts visibility or quality. Fix soon.
//          advice    = best practice / polish. Nice to have.
// basis    official  = stated in Google Search Central or Next.js docs (see `source`).
//          measured  = verifiable fact about the page (HTTP status, tag present...).
//          heuristic = community practice with no official or proven effect. Never gate on it.
// mode     url | source | both

const G = 'https://developers.google.com/search/docs';
const NX = 'https://nextjs.org/docs/app';

export const CATEGORIES = {
  crawl: { en: 'Crawling & indexing', es: 'Rastreo e indexación' },
  metadata: { en: 'Page metadata', es: 'Metadatos de página' },
  social: { en: 'Social sharing (Open Graph)', es: 'Compartir en redes (Open Graph)' },
  schema: { en: 'Structured data', es: 'Datos estructurados' },
  content: { en: 'Content & links', es: 'Contenido y enlaces' },
  geo: { en: 'AI search (GEO)', es: 'Búsqueda con IA (GEO)' },
  nextjs: { en: 'Next.js implementation', es: 'Implementación en Next.js' },
};

export const CHECKS = [
  // ---------- Crawling & indexing ----------
  {
    id: 'crawl.page-ok', category: 'crawl', tier: 'blocker', basis: 'measured', mode: 'url',
    title: { en: 'Page responds with HTTP 200', es: 'La página responde con HTTP 200' },
    why: { en: 'Pages that error or redirect to errors are not indexed.', es: 'Las páginas con error no se indexan.' },
    fix: { en: 'Fix the server error or broken redirect.', es: 'Corrige el error del servidor o la redirección rota.' },
    source: `${G}/crawling-indexing/http-network-errors`,
  },
  {
    id: 'crawl.https', category: 'crawl', tier: 'blocker', basis: 'official', mode: 'url',
    title: { en: 'Site is served over HTTPS and HTTP redirects to it', es: 'El sitio usa HTTPS y HTTP redirige a HTTPS' },
    why: { en: 'HTTPS is a baseline requirement; mixed versions split signals.', es: 'HTTPS es requisito base; versiones mezcladas dividen señales.' },
    fix: { en: 'Force HTTPS with a permanent redirect.', es: 'Fuerza HTTPS con una redirección permanente.' },
    source: `${G}/essentials/technical`,
  },
  {
    id: 'crawl.single-host', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'www / non-www resolve to one canonical host', es: 'www y sin www resuelven a un solo host' },
    why: { en: 'Two live hostnames duplicate every URL.', es: 'Dos hosts activos duplican cada URL.' },
    fix: { en: 'Redirect one hostname to the other with a 301/308.', es: 'Redirige un host al otro con 301/308.' },
    source: `${G}/crawling-indexing/consolidate-duplicate-urls`,
  },
  {
    id: 'crawl.redirect-chain', category: 'crawl', tier: 'advice', basis: 'measured', mode: 'url',
    title: { en: 'Homepage reaches its final URL in at most 2 redirects', es: 'La home llega a su URL final en máximo 2 redirecciones' },
    why: { en: 'Long chains waste crawl budget and slow users.', es: 'Cadenas largas desperdician rastreo y ralentizan.' },
    fix: { en: 'Point links and redirects straight at the final URL.', es: 'Apunta enlaces y redirecciones directo a la URL final.' },
    source: `${G}/crawling-indexing/301-redirects`,
  },
  {
    id: 'crawl.not-noindex', category: 'crawl', tier: 'blocker', basis: 'official', mode: 'url',
    title: { en: 'The audited page is not blocked from indexing (noindex)', es: 'La página auditada no está bloqueada para indexación (noindex)' },
    why: { en: 'A noindex tag or X-Robots-Tag header removes the page from Google.', es: 'Un noindex (meta o cabecera) saca la página de Google.' },
    fix: { en: 'Remove noindex from production pages. Keep it only on staging.', es: 'Quita noindex en producción. Déjalo solo en staging.' },
    source: `${G}/crawling-indexing/block-indexing`,
  },
  {
    id: 'crawl.sitemap-noindex', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Pages listed in the sitemap are indexable (no noindex)', es: 'Las páginas del sitemap son indexables (sin noindex)' },
    why: { en: 'The sitemap says "index this" while the page says "do not index": contradictory signals. If the noindex is intentional, remove the URL from the sitemap; if not, remove the noindex.', es: 'El sitemap dice "indexa esto" y la página dice "no indexar": señales contradictorias. Si el noindex es intencional, quita la URL del sitemap; si no, quita el noindex.' },
    fix: { en: 'Make sitemap and robots directives agree.', es: 'Haz que sitemap y directivas de robots coincidan.' },
    source: `${G}/crawling-indexing/block-indexing`,
  },
  {
    id: 'crawl.robots-exists', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'robots.txt exists and is reachable', es: 'robots.txt existe y es accesible' },
    why: { en: 'Crawlers look for it first; it also advertises the sitemap.', es: 'Los rastreadores lo buscan primero y anuncia el sitemap.' },
    fix: { en: 'Serve /robots.txt (Next.js: app/robots.ts).', es: 'Sirve /robots.txt (Next.js: app/robots.ts).' },
    source: `${G}/crawling-indexing/robots/intro`,
  },
  {
    id: 'crawl.robots-open', category: 'crawl', tier: 'blocker', basis: 'official', mode: 'url',
    title: { en: 'robots.txt does not block the whole site for all bots', es: 'robots.txt no bloquea todo el sitio a todos los bots' },
    why: { en: '"Disallow: /" for User-agent * stops crawling entirely.', es: '"Disallow: /" para User-agent * detiene todo el rastreo.' },
    fix: { en: 'Remove the blanket Disallow on production.', es: 'Quita el Disallow global en producción.' },
    source: `${G}/crawling-indexing/robots/create-robots-txt`,
  },
  {
    id: 'crawl.robots-sitemap', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'robots.txt references the sitemap', es: 'robots.txt referencia el sitemap' },
    why: { en: 'Helps every crawler discover your URLs without Search Console.', es: 'Ayuda a cualquier rastreador a descubrir tus URLs.' },
    fix: { en: 'Add "Sitemap: https://your-domain/sitemap.xml".', es: 'Agrega "Sitemap: https://tu-dominio/sitemap.xml".' },
    source: `${G}/crawling-indexing/sitemaps/build-sitemap`,
  },
  {
    id: 'crawl.sitemap-valid', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'XML sitemap exists and is valid', es: 'Existe un sitemap XML válido' },
    why: { en: 'The sitemap is the main hint for discovering new and changed URLs. Google says a small, well-linked site may not strictly need one, so a missing sitemap is a warning on small sites and a failure on larger ones.', es: 'El sitemap es la pista principal para descubrir URLs nuevas. Google indica que un sitio pequeño y bien enlazado puede no necesitarlo estrictamente, por eso su ausencia es una advertencia en sitios pequeños y una falla en los grandes.' },
    fix: { en: 'Publish a valid sitemap.xml (Next.js: app/sitemap.ts).', es: 'Publica un sitemap.xml válido (Next.js: app/sitemap.ts).' },
    source: `${G}/crawling-indexing/sitemaps/overview`,
  },
  {
    id: 'crawl.sitemap-urls', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Sitemap URLs are absolute, on the same host and return 200', es: 'Las URLs del sitemap son absolutas, del mismo host y devuelven 200' },
    why: { en: 'Sitemaps listing redirects or errors waste crawl and erode trust.', es: 'URLs con redirección o error en el sitemap restan confianza.' },
    fix: { en: 'List only final, canonical, indexable URLs.', es: 'Lista solo URLs finales, canónicas e indexables.' },
    source: `${G}/crawling-indexing/sitemaps/build-sitemap`,
  },
  {
    id: 'crawl.sitemap-lastmod', category: 'crawl', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Sitemap lastmod values look meaningful (not all identical)', es: 'Los lastmod del sitemap son significativos (no todos iguales)' },
    why: { en: 'Google only uses lastmod when it is consistently accurate. A build-time date on every URL makes it useless.', es: 'Google solo usa lastmod si es consistentemente preciso. La fecha de build en todo lo invalida.' },
    fix: { en: 'Use the real last-modified date per page, or omit lastmod.', es: 'Usa la fecha real de modificación por página, o quita lastmod.' },
    source: `${G}/crawling-indexing/sitemaps/build-sitemap`,
  },
  {
    id: 'crawl.sitemap-limits', category: 'crawl', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Sitemap stays under 50,000 URLs / 50 MB', es: 'El sitemap no supera 50.000 URLs / 50 MB' },
    why: { en: 'Larger files are ignored; split with a sitemap index.', es: 'Archivos mayores se ignoran; divide con un índice.' },
    fix: { en: 'Split into multiple sitemaps (Next.js: generateSitemaps).', es: 'Divide en varios sitemaps (Next.js: generateSitemaps).' },
    source: `${NX}/api-reference/file-conventions/metadata/sitemap`,
  },
  {
    id: 'crawl.sitemap-has-page', category: 'crawl', tier: 'advice', basis: 'measured', mode: 'url',
    title: { en: 'Sitemap covers the pages that are linked internally', es: 'El sitemap cubre las páginas enlazadas internamente' },
    why: { en: 'Internal pages missing from the sitemap are slower to discover.', es: 'Páginas internas ausentes del sitemap se descubren más lento.' },
    fix: { en: 'Add the missing indexable URLs to the sitemap.', es: 'Agrega al sitemap las URLs indexables que faltan.' },
    source: `${G}/crawling-indexing/sitemaps/overview`,
  },
  {
    id: 'crawl.soft-404', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Unknown URLs return a real 404 status', es: 'Las URLs inexistentes devuelven un 404 real' },
    why: { en: 'A "not found" page served with 200 is a soft 404 and pollutes the index.', es: 'Una página "no encontrada" con 200 es un soft 404 y contamina el índice.' },
    fix: { en: 'Return status 404 (Next.js: not-found.tsx / notFound()).', es: 'Devuelve estado 404 (Next.js: not-found.tsx / notFound()).' },
    source: `${G}/crawling-indexing/http-network-errors#soft-404-errors`,
  },
  {
    id: 'crawl.canonical', category: 'crawl', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Canonical URL is declared, absolute and self-referencing', es: 'La URL canónica está declarada, es absoluta y apunta a sí misma' },
    why: { en: 'Prevents duplicate-URL dilution (parameters, trailing slash, host). A missing canonical is a recommendation gap (warning). A deep page whose canonical points at the homepage is a failure: it tells Google the page is a duplicate of the home. A canonical pointing to another specific page can be intentional consolidation (warning).', es: 'Evita duplicados por parámetros, barra final o host. Un canonical ausente es una recomendación pendiente (advertencia). Una página interna cuyo canonical apunta a la home es una falla: le dice a Google que es un duplicado de la home. Un canonical hacia otra página concreta puede ser consolidación intencional (advertencia).' },
    fix: { en: 'Add <link rel="canonical"> with the absolute page URL (Next.js: alternates.canonical).', es: 'Agrega <link rel="canonical"> con la URL absoluta (Next.js: alternates.canonical).' },
    source: `${G}/crawling-indexing/consolidate-duplicate-urls`,
  },

  // ---------- Metadata ----------
  {
    id: 'meta.title', category: 'metadata', tier: 'blocker', basis: 'official', mode: 'url',
    title: { en: 'Every page has a <title>', es: 'Cada página tiene <title>' },
    why: { en: 'The title is the main source of the search-result title link.', es: 'El título es la fuente principal del enlace de título en resultados.' },
    fix: { en: 'Set a descriptive, unique title per page.', es: 'Define un título descriptivo y único por página.' },
    source: `${G}/appearance/title-link`,
  },
  {
    id: 'meta.title-length', category: 'metadata', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'Title length is reasonable (about 15–60 characters)', es: 'La longitud del título es razonable (aprox. 15–60 caracteres)' },
    why: { en: 'Google has no fixed limit; very long titles get truncated or rewritten.', es: 'Google no tiene límite fijo; los muy largos se truncan o reescriben.' },
    fix: { en: 'Put the key words first and keep it concise.', es: 'Pon las palabras clave primero y sé conciso.' },
    source: `${G}/appearance/title-link`,
  },
  {
    id: 'meta.title-unique', category: 'metadata', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Titles are unique across pages', es: 'Los títulos son únicos entre páginas' },
    why: { en: 'Identical titles make pages indistinguishable in results.', es: 'Títulos idénticos vuelven las páginas indistinguibles.' },
    fix: { en: 'Give each page its own title (Next.js: title.template + per-page title).', es: 'Da a cada página su propio título (Next.js: title.template + título por página).' },
    source: `${G}/appearance/title-link`,
  },
  {
    id: 'meta.description', category: 'metadata', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Every page has a meta description', es: 'Cada página tiene meta description' },
    why: { en: 'Google often uses it as the result snippet. It is optional (Google generates snippets otherwise), so a missing description is a failure on the homepage and a warning on secondary pages.', es: 'Google la usa con frecuencia como fragmento del resultado. Es opcional (Google genera fragmentos si falta), por eso es una falla en la home y una advertencia en páginas secundarias.' },
    fix: { en: 'Write a unique 70–160 character summary per page.', es: 'Escribe un resumen único de 70–160 caracteres por página.' },
    source: `${G}/appearance/snippet`,
  },
  {
    id: 'meta.description-unique', category: 'metadata', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Descriptions are unique across pages', es: 'Las descripciones son únicas entre páginas' },
    why: { en: 'Duplicate descriptions give Google no page-specific snippet.', es: 'Descripciones duplicadas no aportan fragmento específico.' },
    fix: { en: 'Write page-specific descriptions.', es: 'Escribe descripciones específicas por página.' },
    source: `${G}/appearance/snippet`,
  },
  {
    id: 'meta.h1', category: 'metadata', tier: 'advice', basis: 'measured', mode: 'url',
    title: { en: 'Each page has exactly one <h1>', es: 'Cada página tiene exactamente un <h1>' },
    why: { en: 'A single H1 states the page topic for users, assistive tech and parsers. Google does not require it, and several well-run sites omit it on some pages, so this is advice, not a requirement.', es: 'Un solo H1 declara el tema para usuarios, accesibilidad y parsers. Google no lo exige y varios sitios bien hechos lo omiten en algunas páginas, por eso es un consejo y no un requisito.' },
    fix: { en: 'Use one H1 that matches the page intent.', es: 'Usa un H1 que refleje la intención de la página.' },
    source: `${G}/fundamentals/seo-starter-guide`,
  },
  {
    id: 'meta.lang', category: 'metadata', tier: 'important', basis: 'official', mode: 'url',
    title: { en: '<html> declares a lang attribute', es: '<html> declara el atributo lang' },
    why: { en: 'Helps language detection, accessibility and translations.', es: 'Ayuda a detección de idioma, accesibilidad y traducciones.' },
    fix: { en: 'Set <html lang="es"> (or the right code).', es: 'Define <html lang="es"> (o el código correcto).' },
    source: `${G}/specialty/international/localized-versions`,
  },
  {
    id: 'meta.viewport', category: 'metadata', tier: 'blocker', basis: 'official', mode: 'url',
    title: { en: 'Viewport meta tag is present (mobile-first indexing)', es: 'Existe la meta viewport (indexación mobile-first)' },
    why: { en: 'Google indexes the mobile version; without a viewport the page is not mobile-friendly.', es: 'Google indexa la versión móvil; sin viewport no es mobile-friendly.' },
    fix: { en: 'Add width=device-width, initial-scale=1 (Next.js adds it by default).', es: 'Agrega width=device-width, initial-scale=1 (Next.js lo añade por defecto).' },
    source: `${G}/crawling-indexing/mobile/mobile-sites-mobile-first-indexing`,
  },

  // ---------- Social ----------
  {
    id: 'social.og-basics', category: 'social', tier: 'important', basis: 'measured', mode: 'url',
    title: { en: 'Open Graph basics: og:title, og:description, og:url, og:type', es: 'Open Graph básico: og:title, og:description, og:url, og:type' },
    why: { en: 'Controls how links look on LinkedIn, WhatsApp, Slack, Facebook and more.', es: 'Controla cómo se ve el enlace en LinkedIn, WhatsApp, Slack, Facebook y más.' },
    fix: { en: 'Set openGraph in Next.js metadata.', es: 'Define openGraph en la metadata de Next.js.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'social.og-image', category: 'social', tier: 'important', basis: 'measured', mode: 'url',
    title: { en: 'og:image is present, absolute and loads (HTTP 200, image type)', es: 'og:image existe, es absoluta y carga (HTTP 200, tipo imagen)' },
    why: { en: 'Without a reachable image, shared links show a blank card.', es: 'Sin imagen accesible, el enlace compartido se ve vacío.' },
    fix: { en: 'Add opengraph-image.(jpg|png|tsx) or metadata.openGraph.images and set metadataBase.', es: 'Agrega opengraph-image.(jpg|png|tsx) o metadata.openGraph.images y define metadataBase.' },
    source: `${NX}/api-reference/file-conventions/metadata/opengraph-image`,
  },
  {
    id: 'social.og-image-size', category: 'social', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'og:image is about 1200×630 (1.91:1) and under 5 MB', es: 'og:image mide aprox. 1200×630 (1.91:1) y pesa menos de 5 MB' },
    why: { en: 'The de-facto size across platforms; other ratios get cropped.', es: 'Es el tamaño de facto entre plataformas; otras proporciones se recortan.' },
    fix: { en: 'Export the image at 1200×630 and compress it.', es: 'Exporta la imagen a 1200×630 y comprímela.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'social.twitter-card', category: 'social', tier: 'advice', basis: 'measured', mode: 'url',
    title: { en: 'twitter:card is declared', es: 'twitter:card está declarada' },
    why: { en: 'Selects the large-image card on X.', es: 'Activa la tarjeta con imagen grande en X.' },
    fix: { en: 'Set twitter.card = "summary_large_image".', es: 'Define twitter.card = "summary_large_image".' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'social.icons', category: 'social', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Favicon and apple-touch-icon are declared', es: 'Favicon y apple-touch-icon están declarados' },
    why: { en: 'Google shows the favicon in results.', es: 'Google muestra el favicon en resultados.' },
    fix: { en: 'Add app/icon.png and app/apple-icon.png (or metadata.icons).', es: 'Agrega app/icon.png y app/apple-icon.png (o metadata.icons).' },
    source: `${G}/appearance/favicon-in-search`,
  },

  // ---------- Structured data ----------
  {
    id: 'schema.present', category: 'schema', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Homepage has JSON-LD structured data', es: 'La home tiene datos estructurados JSON-LD' },
    why: { en: 'Structured data tells machines what the page is about and who is behind it. Google only requires it for rich-result eligibility, so a site without it is not broken; it is an opportunity (identity for AI answers, rich results).', es: 'Los datos estructurados dicen a las máquinas de qué trata la página y quién está detrás. Google solo lo exige para ser elegible a resultados enriquecidos, así que un sitio sin ellos no está roto: es una oportunidad (identidad para respuestas de IA, resultados enriquecidos).' },
    fix: { en: 'Add Organization / Person / WebSite JSON-LD.', es: 'Agrega JSON-LD de Organization / Person / WebSite.' },
    source: `${G}/appearance/structured-data/intro-structured-data`,
  },
  {
    id: 'schema.valid', category: 'schema', tier: 'important', basis: 'measured', mode: 'url',
    title: { en: 'JSON-LD parses and declares @context and @type', es: 'El JSON-LD se parsea y declara @context y @type' },
    why: { en: 'Broken JSON-LD is silently ignored.', es: 'Un JSON-LD roto se ignora en silencio.' },
    fix: { en: 'Validate in the Rich Results Test / Schema.org validator.', es: 'Valida en la Rich Results Test / validador de Schema.org.' },
    source: `${G}/appearance/structured-data/sd-policies`,
  },
  {
    id: 'schema.entity', category: 'schema', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Homepage declares an entity (Organization, Person, LocalBusiness or WebSite)', es: 'La home declara una entidad (Organization, Person, LocalBusiness o WebSite)' },
    why: { en: 'Identifies who owns the site; feeds knowledge panels and AI answers.', es: 'Identifica al dueño del sitio; alimenta paneles de conocimiento y respuestas de IA.' },
    fix: { en: 'Add an Organization or Person node with name, url, logo/image.', es: 'Agrega un nodo Organization o Person con name, url, logo/image.' },
    source: `${G}/appearance/structured-data/organization`,
  },
  {
    id: 'schema.required', category: 'schema', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Known schema types include their key properties', es: 'Los tipos de schema conocidos incluyen sus propiedades clave' },
    why: { en: 'Missing required properties make the markup ineligible for rich results.', es: 'Faltar propiedades requeridas deja el marcado sin elegibilidad.' },
    fix: { en: 'Complete the properties listed in the evidence.', es: 'Completa las propiedades indicadas en la evidencia.' },
    source: `${G}/appearance/structured-data/search-gallery`,
  },

  // ---------- Content & links ----------
  {
    id: 'content.server-rendered', category: 'content', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Main content is present in the initial HTML (no JavaScript needed)', es: 'El contenido principal está en el HTML inicial (sin JavaScript)' },
    why: { en: 'Google renders JavaScript but may defer it. Third-party measurements report that most AI crawlers do not run JavaScript at all (not officially documented), so a page that is empty before JavaScript runs may be invisible to them.', es: 'Google ejecuta JavaScript pero puede diferirlo. Mediciones de terceros indican que la mayoría de rastreadores de IA no ejecuta JavaScript (no está documentado oficialmente), por lo que una página vacía antes de JavaScript puede ser invisible para ellos.' },
    fix: { en: 'Render content on the server (Server Components, SSG).', es: 'Renderiza el contenido en el servidor (Server Components, SSG).' },
    source: `${G}/crawling-indexing/javascript/javascript-seo-basics`,
  },
  {
    id: 'content.img-alt', category: 'content', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Images have alt text', es: 'Las imágenes tienen texto alternativo' },
    why: { en: 'Alt text is used for image search and accessibility.', es: 'El alt se usa en búsqueda de imágenes y accesibilidad.' },
    fix: { en: 'Add descriptive alt (alt="" only for decorative images).', es: 'Agrega alt descriptivo (alt="" solo para decorativas).' },
    source: `${G}/appearance/google-images`,
  },
  {
    id: 'content.links', category: 'content', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'Internal links are crawlable <a href> elements', es: 'Los enlaces internos son <a href> rastreables' },
    why: { en: 'Google follows links only from <a> elements with a real href.', es: 'Google solo sigue enlaces de <a> con href real.' },
    fix: { en: 'Avoid href="#", javascript: and click-only navigation.', es: 'Evita href="#", javascript: y navegación solo por click.' },
    source: `${G}/crawling-indexing/links-crawlable`,
  },
  {
    id: 'content.headings', category: 'content', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'Heading levels do not skip (h1 → h2 → h3)', es: 'Los niveles de encabezado no saltan (h1 → h2 → h3)' },
    why: { en: 'A clean outline helps accessibility and content parsing.', es: 'Un esquema limpio ayuda a accesibilidad y análisis de contenido.' },
    fix: { en: 'Fix the heading order.', es: 'Corrige el orden de encabezados.' },
    source: `${G}/fundamentals/seo-starter-guide`,
  },
  {
    id: 'content.hreflang', category: 'content', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'hreflang (if used) is self-referencing and well-formed', es: 'hreflang (si se usa) se autorreferencia y está bien formado' },
    why: { en: 'Bad hreflang makes Google ignore the language/region mapping.', es: 'Un hreflang mal hecho hace que Google ignore el mapeo de idioma/región.' },
    fix: { en: 'Include a self-reference and an x-default.', es: 'Incluye autorreferencia y x-default.' },
    source: `${G}/specialty/international/localized-versions`,
  },

  // ---------- GEO ----------
  {
    id: 'geo.search-bots', category: 'geo', tier: 'important', basis: 'measured', mode: 'url',
    title: { en: 'AI search crawlers are not blocked in robots.txt', es: 'Los rastreadores de búsqueda con IA no están bloqueados en robots.txt' },
    why: { en: 'Search/answer bots (OAI-SearchBot, PerplexityBot, Claude-SearchBot…) decide whether you can be cited. Blocking training bots (GPTBot, Google-Extended, ClaudeBot) is a separate, legitimate choice.', es: 'Los bots de búsqueda/respuesta (OAI-SearchBot, PerplexityBot, Claude-SearchBot…) deciden si te pueden citar. Bloquear bots de entrenamiento (GPTBot, Google-Extended, ClaudeBot) es otra decisión, legítima.' },
    fix: { en: 'Allow the search bots you want to be cited by; decide training bots as a policy.', es: 'Permite los bots de búsqueda por los que quieres ser citado; decide los de entrenamiento como política.' },
    source: 'https://platform.openai.com/docs/bots',
  },
  {
    id: 'geo.bot-access', category: 'geo', tier: 'important', basis: 'measured', mode: 'url',
    title: { en: 'The server/CDN does not block AI crawler user-agents', es: 'El servidor/CDN no bloquea user-agents de rastreadores de IA' },
    why: { en: 'A WAF or bot-protection rule can return 403 to AI crawlers even when robots.txt allows them.', es: 'Un WAF o protección anti-bots puede devolver 403 a rastreadores de IA aunque robots.txt los permita.' },
    fix: { en: 'Allow-list the AI search crawlers in your CDN/WAF.', es: 'Permite los rastreadores de búsqueda de IA en tu CDN/WAF.' },
    source: 'https://platform.openai.com/docs/bots',
  },
  {
    id: 'geo.snippet-controls', category: 'geo', tier: 'important', basis: 'official', mode: 'url',
    title: { en: 'No nosnippet / max-snippet:0 limiting use in AI features', es: 'Sin nosnippet / max-snippet:0 que limite el uso en funciones de IA' },
    why: { en: 'Google applies snippet controls to AI Overviews and AI Mode too.', es: 'Google aplica los controles de fragmento también a AI Overviews y AI Mode.' },
    fix: { en: 'Remove nosnippet unless you intentionally opt out.', es: 'Quita nosnippet salvo que sea una exclusión intencional.' },
    source: `${G}/appearance/ai-features`,
  },
  {
    id: 'geo.entity', category: 'geo', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'Entity is linked to external profiles (sameAs ≥ 2)', es: 'La entidad se enlaza a perfiles externos (sameAs ≥ 2)' },
    why: { en: 'Consistent identity across the web helps systems disambiguate who you are.', es: 'Una identidad consistente en la web ayuda a desambiguar quién eres.' },
    fix: { en: 'Add sameAs links to official profiles.', es: 'Agrega sameAs a perfiles oficiales.' },
    source: `${G}/appearance/structured-data/organization`,
  },
  {
    id: 'geo.freshness-author', category: 'geo', tier: 'advice', basis: 'official', mode: 'url',
    title: { en: 'Article-like pages show an author and a date', es: 'Las páginas tipo artículo muestran autor y fecha' },
    why: { en: 'Google\'s guidance on helpful content recommends clear authorship and dates.', es: 'La guía de contenido útil de Google recomienda autoría y fechas claras.' },
    fix: { en: 'Show byline and dates; add author, datePublished, dateModified to JSON-LD.', es: 'Muestra autor y fechas; agrega author, datePublished, dateModified al JSON-LD.' },
    source: `${G}/fundamentals/creating-helpful-content`,
  },
  {
    id: 'geo.extractable', category: 'geo', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'Content has extractable structure (lists, tables, question headings, concrete facts)', es: 'El contenido tiene estructura extraíble (listas, tablas, preguntas, datos concretos)' },
    why: { en: 'Research on AI citation finds cited pages are modular and rich in definitions, figures, comparisons and steps. Effect size is not established.', es: 'Estudios sobre citas de IA hallan que las páginas citadas son modulares y ricas en definiciones, cifras, comparaciones y pasos. El tamaño del efecto no está establecido.' },
    fix: { en: 'Add direct answers, numbered steps, comparison tables and specific figures where relevant.', es: 'Agrega respuestas directas, pasos numerados, tablas comparativas y cifras específicas donde aplique.' },
    source: 'https://arxiv.org/pdf/2604.25707',
  },
  {
    id: 'geo.llms-txt', category: 'geo', tier: 'advice', basis: 'heuristic', mode: 'url',
    title: { en: 'llms.txt (informational only)', es: 'llms.txt (solo informativo)' },
    why: { en: 'Google states llms.txt has no effect on Search or AI Overviews and independent studies found no citation correlation. Harmless to keep. Never a priority.', es: 'Google indica que llms.txt no tiene efecto en Search ni AI Overviews y estudios independientes no hallaron correlación con citas. Inofensivo mantenerlo. Nunca es prioridad.' },
    fix: { en: 'Optional.', es: 'Opcional.' },
    source: `${G}/fundamentals/ai-optimization-guide`,
  },

  // ---------- Next.js (source mode) ----------
  {
    id: 'next.metadata-base', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'metadataBase is set in the root layout', es: 'metadataBase está definido en el layout raíz' },
    why: { en: 'Relative OG/canonical URLs need metadataBase to resolve to absolute URLs.', es: 'Las URLs relativas de OG/canonical necesitan metadataBase para volverse absolutas.' },
    fix: { en: 'Add metadataBase: new URL("https://your-domain") in app/layout.', es: 'Agrega metadataBase: new URL("https://tu-dominio") en app/layout.' },
    source: `${NX}/api-reference/functions/generate-metadata#metadatabase`,
  },
  {
    id: 'next.root-metadata', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Root metadata defines title (ideally a template) and description', es: 'La metadata raíz define title (idealmente con template) y description' },
    why: { en: 'Gives every route a sensible default and consistent title pattern.', es: 'Da a cada ruta un valor por defecto y un patrón de título consistente.' },
    fix: { en: 'Use title: { default, template: "%s | Brand" } and a description.', es: 'Usa title: { default, template: "%s | Marca" } y una description.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'next.social', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Open Graph / Twitter metadata or opengraph-image file convention is present', es: 'Existe metadata de Open Graph/Twitter o el archivo opengraph-image' },
    why: { en: 'Without it, shared links have no preview.', es: 'Sin esto, los enlaces compartidos no tienen vista previa.' },
    fix: { en: 'Add openGraph + twitter metadata or app/opengraph-image.*.', es: 'Agrega metadata openGraph + twitter o app/opengraph-image.*.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'next.canonical', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Canonical is generated per page (alternates.canonical)', es: 'El canonical se genera por página (alternates.canonical)' },
    why: { en: 'A single canonical in the root layout points every page at the homepage.', es: 'Un canonical único en el layout raíz apunta todas las páginas a la home.' },
    fix: { en: 'Set alternates.canonical in each page / generateMetadata (relative path works with metadataBase).', es: 'Define alternates.canonical en cada página / generateMetadata (la ruta relativa funciona con metadataBase).' },
    source: `${NX}/api-reference/functions/generate-metadata#alternates`,
  },
  {
    id: 'next.sitemap-file', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'sitemap file convention exists', es: 'Existe el archivo sitemap' },
    why: { en: 'Generates /sitemap.xml automatically.', es: 'Genera /sitemap.xml automáticamente.' },
    fix: { en: 'Create app/sitemap.ts.', es: 'Crea app/sitemap.ts.' },
    source: `${NX}/api-reference/file-conventions/metadata/sitemap`,
  },
  {
    id: 'next.robots-file', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'robots file convention exists', es: 'Existe el archivo robots' },
    why: { en: 'Generates /robots.txt automatically.', es: 'Genera /robots.txt automáticamente.' },
    fix: { en: 'Create app/robots.ts.', es: 'Crea app/robots.ts.' },
    source: `${NX}/api-reference/file-conventions/metadata/robots`,
  },
  {
    id: 'next.sitemap-coverage', category: 'nextjs', tier: 'important', basis: 'measured', mode: 'source',
    title: { en: 'Every static route appears in the sitemap', es: 'Cada ruta estática aparece en el sitemap' },
    why: { en: 'Routes missing from a hand-written sitemap are discovered late.', es: 'Rutas ausentes de un sitemap escrito a mano se descubren tarde.' },
    fix: { en: 'Add the missing routes (or generate the sitemap from the route list).', es: 'Agrega las rutas faltantes (o genera el sitemap desde la lista de rutas).' },
    source: `${NX}/api-reference/file-conventions/metadata/sitemap`,
  },
  {
    id: 'next.sitemap-lastmod', category: 'nextjs', tier: 'advice', basis: 'official', mode: 'source',
    title: { en: 'Sitemap does not stamp new Date() as lastModified on every URL', es: 'El sitemap no pone new Date() como lastModified en todas las URLs' },
    why: { en: 'Google ignores lastmod when it is not consistently accurate; new Date() changes on every build.', es: 'Google ignora lastmod si no es consistentemente preciso; new Date() cambia en cada build.' },
    fix: { en: 'Use real content dates, or drop lastModified.', es: 'Usa fechas reales de contenido, o quita lastModified.' },
    source: `${G}/crawling-indexing/sitemaps/build-sitemap`,
  },
  {
    id: 'next.host-consistency', category: 'nextjs', tier: 'important', basis: 'measured', mode: 'source',
    title: { en: 'metadataBase, sitemap and robots use the same host', es: 'metadataBase, sitemap y robots usan el mismo host' },
    why: { en: 'Mixed www/non-www or domains send contradictory canonical signals.', es: 'Mezclar www/sin www o dominios envía señales canónicas contradictorias.' },
    fix: { en: 'Define the site URL once (env var / constant) and reuse it.', es: 'Define la URL del sitio una vez (variable de entorno / constante) y reutilízala.' },
    source: `${G}/crawling-indexing/consolidate-duplicate-urls`,
  },
  {
    id: 'next.dynamic-metadata', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Dynamic routes ([param]) define generateMetadata', es: 'Las rutas dinámicas ([param]) definen generateMetadata' },
    why: { en: 'Otherwise every dynamic page shares the same title and description.', es: 'Si no, todas las páginas dinámicas comparten título y descripción.' },
    fix: { en: 'Export generateMetadata in each dynamic page.', es: 'Exporta generateMetadata en cada página dinámica.' },
    source: `${NX}/getting-started/metadata-and-og-images#generated-metadata`,
  },
  {
    id: 'next.page-metadata', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Each page (or its layout) defines its own metadata', es: 'Cada página (o su layout) define su propia metadata' },
    why: { en: 'Pages without their own title/description inherit the root defaults and look duplicated.', es: 'Páginas sin título/descripción propios heredan los valores raíz y parecen duplicadas.' },
    fix: { en: 'Export metadata or generateMetadata from every indexable page.', es: 'Exporta metadata o generateMetadata en cada página indexable.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'next.client-page', category: 'nextjs', tier: 'important', basis: 'official', mode: 'source',
    title: { en: 'Pages are Server Components (no "use client" at page level)', es: 'Las páginas son Server Components (sin "use client" a nivel de página)' },
    why: { en: 'metadata and generateMetadata only work in Server Components, so a client page cannot define its own metadata; client pages also ship more JavaScript. The homepage can inherit metadata from the layout, so there it is only a warning.', es: 'metadata y generateMetadata solo funcionan en Server Components, así que una página cliente no puede definir su propia metadata; además envía más JavaScript. La home puede heredar metadata del layout, por eso ahí es solo una advertencia.' },
    fix: { en: 'Move interactivity into child components.', es: 'Mueve la interactividad a componentes hijos.' },
    source: `${NX}/getting-started/metadata-and-og-images`,
  },
  {
    id: 'next.icons', category: 'nextjs', tier: 'advice', basis: 'official', mode: 'source',
    title: { en: 'Icons are defined (favicon / icon / apple-icon or metadata.icons)', es: 'Los íconos están definidos (favicon / icon / apple-icon o metadata.icons)' },
    why: { en: 'Favicon is shown in search results and browser tabs.', es: 'El favicon se muestra en resultados y pestañas.' },
    fix: { en: 'Add app/icon.png and app/apple-icon.png.', es: 'Agrega app/icon.png y app/apple-icon.png.' },
    source: `${NX}/api-reference/file-conventions/metadata/app-icons`,
  },
  {
    id: 'next.jsonld', category: 'nextjs', tier: 'advice', basis: 'official', mode: 'source',
    title: { en: 'JSON-LD is rendered in the app', es: 'Se renderiza JSON-LD en la app' },
    why: { en: 'Structured data is the machine-readable layer of the page.', es: 'Los datos estructurados son la capa legible por máquinas.' },
    fix: { en: 'Render a <script type="application/ld+json"> in layout/pages (escape "<").', es: 'Renderiza un <script type="application/ld+json"> en layout/páginas (escapa "<").' },
    source: `${NX}/guides/json-ld`,
  },
  {
    id: 'next.img-tag', category: 'nextjs', tier: 'advice', basis: 'official', mode: 'source',
    title: { en: 'next/image is used instead of raw <img>', es: 'Se usa next/image en lugar de <img> crudo' },
    why: { en: 'Automatic sizing, modern formats and lazy loading help LCP and CLS.', es: 'Tamaño automático, formatos modernos y lazy loading ayudan a LCP y CLS.' },
    fix: { en: 'Replace <img> with <Image>.', es: 'Reemplaza <img> por <Image>.' },
    source: `${NX}/api-reference/components/image`,
  },
  {
    id: 'next.not-found', category: 'nextjs', tier: 'advice', basis: 'official', mode: 'source',
    title: { en: 'A custom not-found page exists', es: 'Existe una página not-found personalizada' },
    why: { en: 'Returns a real 404 with helpful navigation.', es: 'Devuelve un 404 real con navegación útil.' },
    fix: { en: 'Create app/not-found.tsx.', es: 'Crea app/not-found.tsx.' },
    source: `${NX}/api-reference/file-conventions/not-found`,
  },
];

export const CHECK_BY_ID = new Map(CHECKS.map((c) => [c.id, c]));
export const TIER_ORDER = { blocker: 0, important: 1, advice: 2 };
