# Fixes for the source-code review (frameworks other than Next.js)

Snippets are minimal and follow each framework's official documentation. Check the docs for your exact version.
Next.js has its own guide: [`nextjs-fixes.md`](nextjs-fixes.md).

## Astro

Docs: [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)

```js
// astro.config.mjs: `site` is required by the sitemap integration and used for absolute URLs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
export default defineConfig({ site: 'https://your-domain.com', integrations: [sitemap()] });
```
`npx astro add sitemap` installs it. Add `public/robots.txt` (with `Sitemap: https://your-domain.com/sitemap-index.xml`) or an endpoint at `src/pages/robots.txt.ts`.

```astro
---
// src/layouts/Base.astro: canonical built per page, never a fixed URL
const { title, description } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site);
---
<html lang="en"><head>
  <meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
  <title>{title}</title><meta name="description" content={description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content={title} /><meta property="og:image" content="/og.png" />
</head><body><slot /></body></html>
```
Pages then pass `title` and `description` props. Components with `client:only` render in the browser only: prefer `client:load` or `client:visible` for content that matters for search.

## Nuxt

Docs: [useSeoMeta](https://nuxt.com/docs/4.x/api/composables/use-seo-meta), [`ssr`](https://nuxt.com/docs/4.x/api/nuxt-config#ssr)

- `ssr` defaults to `true`. With `ssr: false`, the docs say generated pages have no content: remove it, or prerender the routes.
- Set defaults in `nuxt.config` with `app.head` (title, `titleTemplate`, `htmlAttrs.lang`, description) and per page with `useSeoMeta`:

```vue
<script setup>
useSeoMeta({ title: 'Pricing', description: 'Plans and prices.', ogTitle: 'Pricing', ogImage: '/og.png', twitterCard: 'summary_large_image' })
</script>
```
- Sitemap and robots: the `@nuxtjs/sitemap` and `@nuxtjs/robots` modules (or the `@nuxtjs/seo` bundle), with the site URL set in `site.url`. Or `public/robots.txt` and `server/routes/sitemap.xml.ts`.

## SvelteKit

Docs: [SEO](https://svelte.dev/docs/kit/seo), [page options](https://svelte.dev/docs/kit/page-options)

- Keep server rendering on (the default). `export const ssr = false` in the root layout makes the whole app client-only; the docs advise against it. To serve static HTML, use `export const prerender = true`.
- Every page needs a unique title and description inside `<svelte:head>`:

```svelte
<svelte:head>
  <title>About | Acme</title>
  <meta name="description" content="Who we are and how we work." />
  <link rel="canonical" href={page.url.href} />
</svelte:head>
```
- Or return SEO data from `load` and render it once in the root `+layout.svelte` from `page.data`.
- Sitemap: an endpoint at `src/routes/sitemap.xml/+server.ts` returning XML with `Content-Type: application/xml`. Robots: `static/robots.txt`.

## Vite / React / Vue / Angular single-page apps

A client-rendered app serves one empty `index.html` for every route and JavaScript fills it in. Google renders JavaScript but may defer it; AI crawlers are reported not to run it, and social-preview scrapers generally do not either. Options, best first:

1. Move to a framework that renders HTML on the server or at build time (Astro, Next.js, Nuxt, SvelteKit).
2. Keep the SPA and prerender every route at build time (for example `vite-ssg` for Vue, `vike`).
3. At minimum: a head manager (`react-helmet-async`, `@unhead/*`) for per-route titles, real Open Graph tags in `index.html`, **no `<link rel="canonical">` in `index.html`**, and `public/robots.txt` + `public/sitemap.xml`.

## Jekyll

Docs: [jekyll-sitemap](https://github.com/jekyll/jekyll-sitemap)

```yaml
# _config.yml: the sitemap plugin needs `url`, and must be listed here (a Gemfile entry alone is not enough)
url: "https://your-domain.com"
plugins:
  - jekyll-sitemap
  - jekyll-seo-tag     # then put {% seo %} in the <head> of your layout
```
Add `robots.txt` at the project root (Jekyll copies it) with a `Sitemap:` line.

## Hugo

- Hugo generates `sitemap.xml` by default (configure under `[sitemap]`; `disableKinds = ["sitemap"]` turns it off). Set an absolute `baseURL`.
- `enableRobotsTXT = true`, or add `static/robots.txt`.
- In `layouts/_default/baseof.html`: `<title>{{ .Title }}</title>`, `<link rel="canonical" href="{{ .Permalink }}">`, `{{ template "_internal/opengraph.html" . }}`, `{{ template "_internal/twitter_cards.html" . }}`, `{{ template "_internal/schema.html" . }}`.

## Laravel · Django · Rails

| | Sitemap | Head tags |
|---|---|---|
| Laravel | `spatie/laravel-sitemap` | Blade layout, or `artesaos/seotools` |
| Django | `django.contrib.sitemaps` in `INSTALLED_APPS` + a sitemap view | `templates/base.html` with `{% block title %}` |
| Rails | the `sitemap_generator` gem (`config/sitemap.rb`) | `application.html.erb`, or the `meta-tags` gem |

Canonical per page: `{{ url()->current() }}` (Blade), `{{ request.build_absolute_uri }}` (Django), `request.original_url` without the query string (Rails). Put `robots.txt` in `public/` (Laravel, Rails) or serve it from a template/static route (Django).

## WordPress

Docs: [add_theme_support](https://developer.wordpress.org/reference/functions/add_theme_support/)

- Classic themes: `add_theme_support( 'title-tag' );` in `functions.php` (hooked on `after_setup_theme`) and `<?php wp_head(); ?>` before `</head>` in `header.php`.
- Block themes (`theme.json` + `templates/*.html`) have no `header.php`: WordPress core renders the title for block templates, so those two checks are skipped.
- Descriptions, canonical, Open Graph and schema normally come from an SEO plugin (Yoast SEO, Rank Math, SEOPress). A plugin installed only on the live site cannot be seen from the theme files: use the URL audit to see what is actually served.
