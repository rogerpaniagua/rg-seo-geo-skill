# The SEO & GEO standard

Every check the audit runs, in one place. This file is generated from `scripts/lib/catalog.mjs`: edit the catalog, then run `npm run docs`.

## Tiers

- **Blocker**: breaks indexing or sharing. Fix before launch. Only measurable or officially documented rules can be blockers.
- **Important**: hurts visibility or quality. Fix soon.
- **Advice**: polish and best practice.

## Basis (how much to trust a rule)

- **Official**: stated in Google Search Central or Next.js documentation (source linked).
- **Measured**: a verifiable fact about your page or code (a status code, a tag).
- **Heuristic**: community practice with no official or proven effect. Never a blocker, never presented as a requirement.

## Published site

### Crawling & indexing

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Blocker | Page responds with HTTP 200 | Pages that error or redirect to errors are not indexed. | Fix the server error or broken redirect. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/http-network-errors) |
| Blocker | Site is served over HTTPS and HTTP redirects to it | HTTPS is a baseline requirement; mixed versions split signals. | Force HTTPS with a permanent redirect. | Official | [link](https://developers.google.com/search/docs/essentials/technical) |
| Important | www / non-www resolve to one canonical host | Two live hostnames duplicate every URL. | Redirect one hostname to the other with a 301/308. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| Advice | Homepage reaches its final URL in at most 2 redirects | Long chains waste crawl budget and slow users. | Point links and redirects straight at the final URL. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/301-redirects) |
| Blocker | The audited page is not blocked from indexing (noindex) | A noindex tag or X-Robots-Tag header removes the page from Google. | Remove noindex from production pages. Keep it only on staging. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/block-indexing) |
| Important | Pages listed in the sitemap are indexable (no noindex) | The sitemap says "index this" while the page says "do not index": contradictory signals. If the noindex is intentional, remove the URL from the sitemap; if not, remove the noindex. | Make sitemap and robots directives agree. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/block-indexing) |
| Important | robots.txt exists and is reachable | Crawlers look for it first; it also advertises the sitemap. | Serve /robots.txt (Next.js: app/robots.ts). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/robots/intro) |
| Blocker | robots.txt does not block the whole site for all bots | "Disallow: /" for User-agent * stops crawling entirely. | Remove the blanket Disallow on production. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt) |
| Important | robots.txt references the sitemap | Helps every crawler discover your URLs without Search Console. | Add "Sitemap: https://your-domain/sitemap.xml". | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| Important | XML sitemap exists and is valid | The sitemap is the main hint for discovering new and changed URLs. Google says a small, well-linked site may not strictly need one, so a missing sitemap is a warning on small sites and a failure on larger ones. | Publish a valid sitemap.xml (Next.js: app/sitemap.ts). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) |
| Important | Sitemap URLs are absolute, on the same host and return 200 | Sitemaps listing redirects or errors waste crawl and erode trust. | List only final, canonical, indexable URLs. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| Advice | Sitemap lastmod values look meaningful (not all identical) | Google only uses lastmod when it is consistently accurate. A build-time date on every URL makes it useless. | Use the real last-modified date per page, or omit lastmod. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| Advice | Sitemap stays under 50,000 URLs / 50 MB | Larger files are ignored; split with a sitemap index. | Split into multiple sitemaps (Next.js: generateSitemaps). | Official | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) |
| Advice | Sitemap covers the pages that are linked internally | Internal pages missing from the sitemap are slower to discover. | Add the missing indexable URLs to the sitemap. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) |
| Important | Unknown URLs return a real 404 status | A "not found" page served with 200 is a soft 404 and pollutes the index. | Return status 404 (Next.js: not-found.tsx / notFound()). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors) |
| Important | Canonical URL is declared, absolute and self-referencing | Prevents duplicate-URL dilution (parameters, trailing slash, host). A missing canonical is a recommendation gap (warning). A deep page whose canonical points at the homepage is a failure: it tells Google the page is a duplicate of the home. A canonical pointing to another specific page can be intentional consolidation (warning). | Add <link rel="canonical"> with the absolute page URL (Next.js: alternates.canonical). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |

### Page metadata

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Blocker | Every page has a <title> | The title is the main source of the search-result title link. | Set a descriptive, unique title per page. | Official | [link](https://developers.google.com/search/docs/appearance/title-link) |
| Advice | Title length is reasonable (about 15–60 characters) | Google has no fixed limit; very long titles get truncated or rewritten. | Put the key words first and keep it concise. | Heuristic | [link](https://developers.google.com/search/docs/appearance/title-link) |
| Important | Titles are unique across pages | Identical titles make pages indistinguishable in results. | Give each page its own title (Next.js: title.template + per-page title). | Official | [link](https://developers.google.com/search/docs/appearance/title-link) |
| Important | Every page has a meta description | Google often uses it as the result snippet. It is optional (Google generates snippets otherwise), so a missing description is a failure on the homepage and a warning on secondary pages. | Write a unique 70–160 character summary per page. | Official | [link](https://developers.google.com/search/docs/appearance/snippet) |
| Advice | Descriptions are unique across pages | Duplicate descriptions give Google no page-specific snippet. | Write page-specific descriptions. | Official | [link](https://developers.google.com/search/docs/appearance/snippet) |
| Advice | Each page has exactly one <h1> | A single H1 states the page topic for users, assistive tech and parsers. Google does not require it, and several well-run sites omit it on some pages, so this is advice, not a requirement. | Use one H1 that matches the page intent. | Measured | [link](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) |
| Important | <html> declares a lang attribute | Helps language detection, accessibility and translations. | Set <html lang="es"> (or the right code). | Official | [link](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| Blocker | Viewport meta tag is present (mobile-first indexing) | Google indexes the mobile version; without a viewport the page is not mobile-friendly. | Add width=device-width, initial-scale=1 (Next.js adds it by default). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) |

### Social sharing (Open Graph)

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | Open Graph basics: og:title, og:description, og:url, og:type | Controls how links look on LinkedIn, WhatsApp, Slack, Facebook and more. | Set openGraph in Next.js metadata. | Measured | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Important | og:image is present, absolute and loads (HTTP 200, image type) | Without a reachable image, shared links show a blank card. | Add opengraph-image.(jpg\|png\|tsx) or metadata.openGraph.images and set metadataBase. | Measured | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) |
| Advice | og:image is about 1200×630 (1.91:1) and under 5 MB | The de-facto size across platforms; other ratios get cropped. | Export the image at 1200×630 and compress it. | Heuristic | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Advice | twitter:card is declared | Selects the large-image card on X. | Set twitter.card = "summary_large_image". | Measured | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Advice | Favicon and apple-touch-icon are declared | Google shows the favicon in results. | Add app/icon.png and app/apple-icon.png (or metadata.icons). | Official | [link](https://developers.google.com/search/docs/appearance/favicon-in-search) |

### Structured data

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Advice | Homepage has JSON-LD structured data | Structured data tells machines what the page is about and who is behind it. Google only requires it for rich-result eligibility, so a site without it is not broken; it is an opportunity (identity for AI answers, rich results). | Add Organization / Person / WebSite JSON-LD. | Official | [link](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) |
| Important | JSON-LD parses and declares @context and @type | Broken JSON-LD is silently ignored. | Validate in the Rich Results Test / Schema.org validator. | Measured | [link](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) |
| Advice | Homepage declares an entity (Organization, Person, LocalBusiness or WebSite) | Identifies who owns the site; feeds knowledge panels and AI answers. | Add an Organization or Person node with name, url, logo/image. | Official | [link](https://developers.google.com/search/docs/appearance/structured-data/organization) |
| Advice | Known schema types include their key properties | Missing required properties make the markup ineligible for rich results. | Complete the properties listed in the evidence. | Official | [link](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) |

### Content & links

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | Main content is present in the initial HTML (no JavaScript needed) | Google renders JavaScript but may defer it. Third-party measurements report that most AI crawlers do not run JavaScript at all (not officially documented), so a page that is empty before JavaScript runs may be invisible to them. | Render content on the server (Server Components, SSG). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) |
| Important | Images have alt text | Alt text is used for image search and accessibility. | Add descriptive alt (alt="" only for decorative images). | Official | [link](https://developers.google.com/search/docs/appearance/google-images) |
| Important | Internal links are crawlable <a href> elements | Google follows links only from <a> elements with a real href. | Avoid href="#", javascript: and click-only navigation. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) |
| Advice | Heading levels do not skip (h1 → h2 → h3) | A clean outline helps accessibility and content parsing. | Fix the heading order. | Heuristic | [link](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) |
| Important | hreflang (if used) is self-referencing and well-formed | Bad hreflang makes Google ignore the language/region mapping. | Include a self-reference and an x-default. | Official | [link](https://developers.google.com/search/docs/specialty/international/localized-versions) |

### Site health

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | Internal links lead to working pages (no 404 / 410 / server errors) | Broken links waste crawl budget, frustrate users and weaken the pages they point to. Only a sample of links from the audited pages is checked. | Fix or remove the broken links, or redirect the old URL to its replacement. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/http-network-errors) |
| Advice | Internal links point straight at the final URL (no permanent redirect) | A link that goes through a permanent redirect (301/308) is out of date: every visit adds latency and dilutes signals. Temporary redirects (302/307) and login/API endpoints are usually deliberate and are not reported. | Update the link to the redirect target. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/301-redirects) |
| Important | HTTPS pages load no subresources over http:// (mixed content) | Browsers block or warn about http:// scripts, styles, images and frames on https pages, which breaks the page and its security. | Load every resource over https:// (or protocol-relative paths). | Official | [link](https://web.dev/articles/what-is-mixed-content) |
| Advice | Images declare width and height (prevents layout shift) | Without dimensions the browser cannot reserve space, so content jumps as images load (Cumulative Layout Shift). Only the HTML attributes are inspected: a page that reserves the space with CSS (aspect-ratio, sized wrappers) is fine, so treat this as advice. | Add width and height attributes (next/image does it for you) or reserve the space with CSS aspect-ratio. | Official | [link](https://web.dev/articles/optimize-cls) |

### AI search (GEO)

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | AI search crawlers are not blocked in robots.txt | Search/answer bots (OAI-SearchBot, PerplexityBot, Claude-SearchBot…) decide whether you can be cited. Blocking training bots (GPTBot, Google-Extended, ClaudeBot) is a separate, legitimate choice. | Allow the search bots you want to be cited by; decide training bots as a policy. | Measured | [link](https://platform.openai.com/docs/bots) |
| Important | The server/CDN lets AI search crawlers through | A WAF or bot-protection rule can return 403 to AI crawlers even when robots.txt allows them. Only search/answer bots (OAI-SearchBot, PerplexityBot) matter for being cited. Refusing the training bots (GPTBot, ClaudeBot) is a legitimate policy and is reported as information, not as a problem. | Allow-list the AI search crawlers in your CDN/WAF (the training bots are your call). | Measured | [link](https://platform.openai.com/docs/bots) |
| Important | No nosnippet / max-snippet:0 limiting use in AI features | Google applies snippet controls to AI Overviews and AI Mode too. | Remove nosnippet unless you intentionally opt out. | Official | [link](https://developers.google.com/search/docs/appearance/ai-features) |
| Advice | Entity is linked to external profiles (sameAs ≥ 2) | Consistent identity across the web helps systems disambiguate who you are. | Add sameAs links to official profiles. | Heuristic | [link](https://developers.google.com/search/docs/appearance/structured-data/organization) |
| Advice | Article-like pages show an author and a date | Google's guidance on helpful content recommends clear authorship and dates. | Show byline and dates; add author, datePublished, dateModified to JSON-LD. | Official | [link](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| Advice | Content has extractable structure (lists, tables, question headings, concrete facts) | Research on AI citation finds cited pages are modular and rich in definitions, figures, comparisons and steps. Effect size is not established. | Add direct answers, numbered steps, comparison tables and specific figures where relevant. | Heuristic | [link](https://arxiv.org/pdf/2604.25707) |
| Advice | Homepage links to at least one of About, Contact or Privacy | Google's helpful-content guidance asks "who is behind this content"; visible about/contact/privacy pages are the usual answer, for people and for systems judging a source. Detected from link paths only. | Add and link About, Contact and Privacy pages (or sections, for one-page sites) from the header or footer. | Heuristic | [link](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| Advice | llms.txt (informational only) | Google states llms.txt has no effect on Search or AI Overviews and independent studies found no citation correlation. Harmless to keep. Never a priority. | Optional. | Heuristic | [link](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |

## Source code (Next.js, Astro, Nuxt, SvelteKit, SPAs, template stacks, WordPress)

### Next.js implementation

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | metadataBase is set in the root layout | Relative OG/canonical URLs need metadataBase to resolve to absolute URLs. | Add metadataBase: new URL("https://your-domain") in app/layout. | Official | [link](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#metadatabase) |
| Important | Root metadata defines title (ideally a template) and description | Gives every route a sensible default and consistent title pattern. | Use title: { default, template: "%s \| Brand" } and a description. | Official | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Important | Open Graph / Twitter metadata or opengraph-image file convention is present | Without it, shared links have no preview. | Add openGraph + twitter metadata or app/opengraph-image.*. | Official | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Important | Canonical is generated per page (alternates.canonical) | A single canonical in the root layout points every page at the homepage. | Set alternates.canonical in each page / generateMetadata (relative path works with metadataBase). | Official | [link](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#alternates) |
| Important | sitemap file convention exists | Generates /sitemap.xml automatically. | Create app/sitemap.ts. | Official | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) |
| Important | robots file convention exists | Generates /robots.txt automatically. | Create app/robots.ts. | Official | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots) |
| Important | Every static route appears in the sitemap | Routes missing from a hand-written sitemap are discovered late. | Add the missing routes (or generate the sitemap from the route list). | Measured | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) |
| Advice | Sitemap does not stamp new Date() as lastModified on every URL | Google ignores lastmod when it is not consistently accurate; new Date() changes on every build. | Use real content dates, or drop lastModified. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| Important | metadataBase, sitemap and robots use the same host | Mixed www/non-www or domains send contradictory canonical signals. | Define the site URL once (env var / constant) and reuse it. | Measured | [link](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| Important | Dynamic routes ([param]) define generateMetadata | Otherwise every dynamic page shares the same title and description. | Export generateMetadata in each dynamic page. | Official | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images#generated-metadata) |
| Important | Each page (or its layout) defines its own metadata | Pages without their own title/description inherit the root defaults and look duplicated. | Export metadata or generateMetadata from every indexable page. | Official | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Important | Pages are Server Components (no "use client" at page level) | metadata and generateMetadata only work in Server Components, so a client page cannot define its own metadata; client pages also ship more JavaScript. The homepage can inherit metadata from the layout, so there it is only a warning. | Move interactivity into child components. | Official | [link](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| Advice | Icons are defined (favicon / icon / apple-icon or metadata.icons) | Favicon is shown in search results and browser tabs. | Add app/icon.png and app/apple-icon.png. | Official | [link](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons) |
| Advice | JSON-LD is rendered in the app | Structured data is the machine-readable layer of the page. | Render a <script type="application/ld+json"> in layout/pages (escape "<"). | Official | [link](https://nextjs.org/docs/app/guides/json-ld) |
| Advice | next/image is used instead of raw <img> | Automatic sizing, modern formats and lazy loading help LCP and CLS. | Replace <img> with <Image>. | Official | [link](https://nextjs.org/docs/app/api-reference/components/image) |
| Advice | A custom not-found page exists | Returns a real 404 with helpful navigation. | Create app/not-found.tsx. | Official | [link](https://nextjs.org/docs/app/api-reference/file-conventions/not-found) |

### Source code (other frameworks)

| Tier | Check | Why | How to fix | Basis | Source |
|---|---|---|---|---|---|
| Important | Content is rendered into the HTML (not only in the browser) | Google renders JavaScript but may defer it; AI crawlers are reported by third-party measurements not to run it at all. A client-only app, or ssr: false, serves an empty shell. The Nuxt and SvelteKit docs say the same about their ssr options. | Turn server rendering back on, or prerender every route at build time. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) |
| Important | The production site URL is configured (needed for sitemap and canonical URLs) | Sitemaps and canonical links must hold absolute URLs. Astro, Jekyll and Hugo need the site URL in their config to build them. | Set it in the framework config (Astro: site, Jekyll: url, Hugo: baseURL, Nuxt: site.url). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| Important | The base layout defines title, description, viewport and html lang | These tags are the basis of the result title, the snippet and mobile-first indexing. This is a heuristic over all template files: a tag generated by a plugin or helper the review does not recognise may be reported as missing. | Add the missing tags to the base layout/head partial. | Official | [link](https://developers.google.com/search/docs/appearance/title-link) |
| Important | Every page sets its own title and description | Pages that inherit one shared title look duplicated in results. SvelteKit's docs ask for a unique title and description in <svelte:head> on every page; Nuxt recommends useSeoMeta. | Set title and description per page (props to the layout, useSeoMeta, <svelte:head>, a head manager). | Official | [link](https://developers.google.com/search/docs/appearance/title-link) |
| Important | Canonical is built per page, never a fixed URL in a shared layout | A canonical hardcoded in a layout or in an SPA shell is identical on every page that uses it, so each page tells Google it duplicates that one URL. A missing canonical is only a recommendation gap. | Generate it from the current page URL. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| Important | Open Graph tags are defined | Without them, shared links have no preview on LinkedIn, WhatsApp, Slack or Facebook. Social scrapers do not run JavaScript, so tags added only at runtime are not seen. | Add og:title, og:description, og:image (and twitter:card) to the layout. | Measured | [link](https://ogp.me/) |
| Advice | JSON-LD structured data is present | Structured data is the machine-readable identity of the site; Google requires it only for rich-result eligibility, so its absence is not a defect. | Add Organization / Person / WebSite JSON-LD. | Official | [link](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) |
| Important | No unconditional noindex is left in a layout or template | A noindex copied from staging into a shared layout removes the whole site from Google at launch. The review cannot always tell a conditional one from an unconditional one, so it asks you to check. | Apply noindex only on staging/preview, through an environment check. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/block-indexing) |
| Important | A sitemap is generated or provided | The sitemap is the main hint for discovering new and changed URLs. Each framework has its own mechanism: Astro integration, Nuxt module, SvelteKit endpoint, jekyll-sitemap (which needs a _config.yml entry), Hugo (on by default), django.contrib.sitemaps. | Add the sitemap mechanism of your framework (see references/source-fixes.md). | Official | [link](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) |
| Important | A robots.txt is provided | Crawlers look for it first and it advertises the sitemap. | Add robots.txt in the static folder (public/, static/) with a Sitemap: line. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/robots/intro) |
| Blocker | The static robots.txt does not block the whole site | "Disallow: /" for every bot is the classic staging leftover and stops all crawling. | Remove the blanket Disallow before launch. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt) |
| Advice | Images use the framework image component instead of raw <img> | Image components size, lazy-load and convert images, which helps LCP and layout shift. | Astro <Image />, @nuxt/image, @sveltejs/enhanced-img. | Official | [link](https://web.dev/articles/optimize-cls) |
| Advice | A custom 404 page exists | Unknown URLs should return a helpful page with a real 404 status, not a soft 404. | Create the 404 page of your framework. | Official | [link](https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors) |
| Important | WordPress theme declares add_theme_support('title-tag') | Per the WordPress developer docs it lets WordPress and plugins manage the document title. Without it the title is whatever the theme hardcodes. | Add add_theme_support( 'title-tag' ) to functions.php, hooked on after_setup_theme. | Official | [link](https://developer.wordpress.org/reference/functions/add_theme_support/) |
| Important | The theme calls wp_head() | wp_head() is the hook through which SEO, schema and social plugins print their tags in the <head>. Without it they have nowhere to output them. | Add <?php wp_head(); ?> just before </head> in header.php. | Measured | [link](https://developer.wordpress.org/reference/functions/wp_head/) |
| Advice | An SEO plugin (Yoast, Rank Math, SEOPress) is part of the project | Descriptions, canonical, Open Graph and schema in WordPress usually come from a plugin. It may be installed on the live site without being in this repository, so this is only a hint. | Install and configure an SEO plugin. | Heuristic | [link](https://wordpress.org/plugins/wordpress-seo/) |
