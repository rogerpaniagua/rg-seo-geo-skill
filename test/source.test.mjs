// Source-code review for frameworks other than Next.js. Each project is built on the fly so a test
// reads like the scenario it checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';
import { runSourceAudit } from '../skills/rg-seo-geo-skill/scripts/lib/source/index.mjs';

function mkproj(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
function audit(files) {
  const c = new Collector();
  const out = runSourceAudit({ src: mkproj(files) }, c);
  const r = c.results();
  const st = (id) => (r.find((x) => x.id === id) || {}).status;
  const ev = (id) => ((r.find((x) => x.id === id) || {}).evidence || []).join(' | ');
  return { out, r, st, ev };
}
const pkg = (deps, extra = {}) => ({ name: 'x', dependencies: deps, ...extra });
const HEAD = '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><meta name="description" content={description}></head><body><slot/></body></html>';

// ======================= detection and dispatch =======================
test('dispatcher: identifies the framework and labels the report', () => {
  assert.match(audit({ 'package.json': pkg({ astro: '^5.0.0' }), 'astro.config.mjs': 'export default {}' }).out.meta.framework, /^Astro/);
  assert.match(audit({ 'package.json': pkg({ nuxt: '^3.10.0' }), 'nuxt.config.ts': 'export default defineNuxtConfig({})' }).out.meta.framework, /^Nuxt/);
  assert.match(audit({ 'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '^2.0.0' } }), 'src/routes/+page.svelte': '<h1>x</h1>' }).out.meta.framework, /^SvelteKit/);
  assert.match(audit({ 'package.json': pkg({ react: '^18', vite: '^5' }), 'index.html': '<html></html>' }).out.meta.framework, /React|Vite|single-page/i);
  assert.equal(audit({ 'package.json': pkg({ next: '^16.0.0' }), 'app/layout.tsx': 'export default function L(){return null}' }).out.meta.framework.startsWith('Next.js'), true);
});

test('dispatcher: an unrecognised project gives a clear note, never a crash', () => {
  const { out } = audit({ 'README.md': 'nothing here' });
  assert.equal(out.skipped, true);
  assert.match(out.meta.note, /--build|--url/);
});

test('dispatcher: finds the app inside a monorepo, and refuses to guess between several', () => {
  const one = audit({ 'package.json': { name: 'mono', private: true }, 'apps/web/package.json': pkg({ astro: '^5' }), 'apps/web/astro.config.mjs': 'export default {}' });
  assert.match(one.out.meta.framework, /^Astro/);
  assert.match(one.out.meta.note || '', /apps\/web/);
  const two = audit({ 'package.json': { name: 'mono' }, 'apps/a/package.json': pkg({ astro: '^5' }), 'apps/a/astro.config.mjs': 'export default {}', 'apps/b/package.json': pkg({ nuxt: '^3' }), 'apps/b/nuxt.config.ts': 'export default defineNuxtConfig({})' });
  assert.equal(two.out.skipped, true);
  assert.match(two.out.meta.note, /apps\/a/);
  assert.match(two.out.meta.note, /apps\/b/);
});

// ======================= Astro =======================
const ASTRO_GOOD = {
  'package.json': pkg({ astro: '^5.0.0', '@astrojs/sitemap': '^3.0.0' }),
  'astro.config.mjs': "import sitemap from '@astrojs/sitemap';\nexport default { site: 'https://example.com', integrations: [sitemap()] };",
  'public/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap-index.xml',
  'src/layouts/Base.astro': `---\nconst { title, description } = Astro.props;\nconst canonical = new URL(Astro.url.pathname, Astro.site);\n---\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><meta name="description" content={description}><link rel="canonical" href={canonical}><meta property="og:title" content={title}><meta property="og:image" content="/og.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json" set:html={JSON.stringify({})}/></head><body><slot/></body></html>`,
  'src/pages/index.astro': '---\nimport Base from "../layouts/Base.astro";\n---\n<Base title="Home" description="The home page"><h1>Hi</h1></Base>',
  'src/pages/about.astro': '---\nimport Base from "../layouts/Base.astro";\n---\n<Base title="About" description="About us"><h1>About</h1></Base>',
  'src/pages/404.astro': '<h1>Not found</h1>',
};
test('Astro: a well-configured project passes the core checks', () => {
  const { st, ev } = audit(ASTRO_GOOD);
  for (const id of ['src.site-url', 'src.sitemap', 'src.robots', 'src.robots-open', 'src.head-essentials', 'src.canonical', 'src.social', 'src.page-metadata', 'src.not-found', 'src.jsonld']) assert.equal(st(id), 'pass', `${id}: ${ev(id)}`);
});

test('Astro: missing site, sitemap, robots, and a canonical hardcoded in the layout are found', () => {
  const { st, ev } = audit({
    'package.json': pkg({ astro: '^5.0.0' }),
    'astro.config.mjs': 'export default {};',
    'src/layouts/Base.astro': '<html><head><link rel="canonical" href="https://example.com/"></head><body><slot/></body></html>',
    'src/pages/index.astro': '---\nimport Base from "../layouts/Base.astro";\n---\n<Base><img src="/a.png"><Island client:only="react"/></Base>',
    'src/pages/blog/post.astro': '---\nimport Base from "../../layouts/Base.astro";\n---\n<Base><h1>Post</h1></Base>',
  });
  assert.equal(st('src.site-url'), 'warn');
  assert.match(ev('src.site-url'), /astro\.config/);
  assert.equal(st('src.sitemap'), 'fail');
  assert.match(ev('src.sitemap'), /astro add sitemap/);
  assert.equal(st('src.robots'), 'fail');
  assert.equal(st('src.canonical'), 'fail');
  assert.match(ev('src.canonical'), /Base\.astro/);
  assert.equal(st('src.head-essentials'), 'fail');
  assert.equal(st('src.page-metadata'), 'fail');
  assert.equal(st('src.rendering'), 'warn');
  assert.match(ev('src.rendering'), /client:only/);
  assert.equal(st('src.images'), 'warn');
  assert.equal(st('src.not-found'), 'warn');
});

test('Astro: sitemap integration without `site` is a failure (the build cannot generate it)', () => {
  const { st } = audit({ 'package.json': pkg({ astro: '^5', '@astrojs/sitemap': '^3' }), 'astro.config.mjs': "import sitemap from '@astrojs/sitemap'; export default { integrations: [sitemap()] };" });
  assert.equal(st('src.site-url'), 'fail');
});

// ======================= Nuxt =======================
test('Nuxt: ssr:false is a failure; pages without useSeoMeta/useHead are listed', () => {
  const { st, ev } = audit({
    'package.json': pkg({ nuxt: '^3.10.0' }),
    'nuxt.config.ts': 'export default defineNuxtConfig({ ssr: false })',
    'pages/index.vue': '<template><h1>x</h1></template>',
    'pages/about.vue': '<script setup>useSeoMeta({ title: "About", description: "About us" })</script><template><h1>x</h1></template>',
  });
  assert.equal(st('src.rendering'), 'fail');
  assert.match(ev('src.rendering'), /ssr: false/);
  assert.equal(st('src.page-metadata'), 'fail');
  assert.match(ev('src.page-metadata'), /in: \//);              // the home route, shown by URL path
  assert.doesNotMatch(ev('src.page-metadata'), /about/);
  assert.equal(st('src.sitemap'), 'fail');
  assert.equal(st('src.robots'), 'fail');
});

test('Nuxt: sitemap/robots modules, @nuxtjs/seo and head defaults count', () => {
  const { st, ev } = audit({
    'package.json': pkg({ nuxt: '^3.10.0', '@nuxtjs/seo': '^2.0.0' }),
    'nuxt.config.ts': "export default defineNuxtConfig({ modules: ['@nuxtjs/seo'], site: { url: 'https://example.com' }, app: { head: { htmlAttrs: { lang: 'en' }, title: 'Site', titleTemplate: '%s | Site', meta: [{ name: 'description', content: 'A site' }] } } })",
    'pages/index.vue': '<script setup>useSeoMeta({ title: "Home", ogTitle: "Home", description: "d", ogImage: "/og.png" })</script><template><h1>x</h1></template>',
  });
  for (const id of ['src.rendering', 'src.sitemap', 'src.robots', 'src.page-metadata', 'src.head-essentials', 'src.social']) assert.equal(st(id), 'pass', `${id}: ${ev(id)}`);
});

test('Nuxt: a canonical hardcoded in app.head applies to every page', () => {
  const { st, ev } = audit({
    'package.json': pkg({ nuxt: '^3.10.0' }),
    'nuxt.config.ts': "export default defineNuxtConfig({ app: { head: { link: [{ rel: 'canonical', href: 'https://example.com/' }] } } })",
    'pages/index.vue': '<template><h1>x</h1></template>',
  });
  assert.equal(st('src.canonical'), 'fail');
  assert.match(ev('src.canonical'), /nuxt\.config/);
});

// ======================= SvelteKit =======================
test('SvelteKit: ssr=false in the root layout makes the whole app client-only', () => {
  const { st, ev } = audit({
    'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    'svelte.config.js': 'export default {}',
    'src/routes/+layout.ts': 'export const ssr = false;',
    'src/routes/+page.svelte': '<h1>x</h1>',
  });
  assert.equal(st('src.rendering'), 'fail');
  assert.match(ev('src.rendering'), /\+layout/);
});

test('SvelteKit: every page needs its own <title>/description in <svelte:head>; sitemap endpoint and static robots count', () => {
  const good = audit({
    'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    'src/app.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"> %sveltekit.head%</head><body>%sveltekit.body%</body></html>',
    'src/routes/+page.svelte': '<svelte:head><title>Home</title><meta name="description" content="Home page"><link rel="canonical" href="https://example.com/"><meta property="og:title" content="Home"></svelte:head><h1>x</h1>',
    'src/routes/about/+page.svelte': '<svelte:head><title>About</title><meta name="description" content="About"></svelte:head><h1>x</h1>',
    'src/routes/sitemap.xml/+server.ts': 'export const GET = () => new Response("<urlset/>")',
    'static/robots.txt': 'User-agent: *\nAllow: /',
  });
  for (const id of ['src.page-metadata', 'src.head-essentials', 'src.sitemap', 'src.robots', 'src.robots-open']) assert.equal(good.st(id), 'pass', `${id}: ${good.ev(id)}`);
  const bad = audit({
    'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    'src/routes/+page.svelte': '<h1>x</h1>',
    'src/routes/about/+page.svelte': '<svelte:head><title>About</title></svelte:head>',
  });
  assert.equal(bad.st('src.page-metadata'), 'fail');
  assert.match(bad.ev('src.page-metadata'), /\//);
  assert.equal(bad.st('src.sitemap'), 'fail');
});

test('SvelteKit: a shared root layout that fills <svelte:head> from page data covers every page', () => {
  const { st, ev } = audit({
    'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    'src/routes/+layout.svelte': '<script>import { page } from "$app/state";</script><svelte:head><title>{page.data.title}</title><meta name="description" content={page.data.description}></svelte:head><slot/>',
    'src/routes/+page.svelte': '<h1>x</h1>',
  });
  assert.equal(st('src.page-metadata'), 'pass', ev('src.page-metadata'));
});

// ======================= Vite / React single-page apps =======================
test('SPA: no prerender and a hardcoded canonical in index.html are the classic launch problems', () => {
  const { st, ev } = audit({
    'package.json': pkg({ react: '^18', 'react-dom': '^18', 'react-router-dom': '^6' }, { devDependencies: { vite: '^5' } }),
    'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>App</title><link rel="canonical" href="https://example.com/"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    'src/App.jsx': 'export default () => null',
  });
  assert.equal(st('src.rendering'), 'fail');
  assert.match(ev('src.rendering'), /every route|same/i);
  assert.equal(st('src.canonical'), 'fail');
  assert.match(ev('src.canonical'), /index\.html/);
  assert.equal(st('src.page-metadata'), 'fail');          // routes but no head manager
  assert.equal(st('src.head-essentials'), 'fail');        // no viewport, no description, no lang
  assert.equal(st('src.sitemap'), 'fail');
  assert.equal(st('src.robots'), 'fail');
});

test('SPA: a prerender tool turns the rendering failure into a pass; a head manager alone is only a warning', () => {
  const base = (deps, dev) => ({ 'package.json': pkg({ react: '^18', 'react-router-dom': '^6', ...deps }, { devDependencies: { vite: '^5', ...dev } }), 'index.html': HEAD.replace(/\{title\}/, 'App').replace('content={description}', 'content="d"'), 'src/App.jsx': 'export default () => null' });
  assert.equal(audit(base({}, { 'vite-ssg': '^0.23' })).st('src.rendering'), 'pass');
  assert.equal(audit(base({ 'react-helmet-async': '^2' })).st('src.rendering'), 'fail');
  assert.equal(audit(base({ 'react-helmet-async': '^2' })).st('src.page-metadata'), 'warn');
  assert.equal(audit(base({ 'react-helmet-async': '^2' }, { 'vite-ssg': '^0.23' })).st('src.page-metadata'), 'pass');
});

// ======================= generic templates (Hugo, Jekyll, Laravel, Django, Rails, PHP, WordPress) =======================
test('Jekyll: seo-tag and sitemap plugins, url config, layout essentials', () => {
  const good = audit({
    '_config.yml': 'url: "https://example.com"\nplugins:\n  - jekyll-sitemap\n  - jekyll-seo-tag\n',
    'Gemfile': "gem 'jekyll'\ngem 'jekyll-sitemap'\ngem 'jekyll-seo-tag'",
    '_layouts/default.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">{% seo %}</head><body>{{ content }}</body></html>',
    'robots.txt': 'User-agent: *\nAllow: /',
    '404.html': '<h1>nf</h1>',
  });
  assert.match(good.out.meta.framework, /Jekyll/);
  for (const id of ['src.head-essentials', 'src.sitemap', 'src.robots', 'src.canonical', 'src.social', 'src.not-found']) assert.equal(good.st(id), 'pass', `${id}: ${good.ev(id)}`);
  const bad = audit({ '_config.yml': 'title: x', '_layouts/default.html': '<html><head></head><body>{{ content }}</body></html>' });
  assert.equal(bad.st('src.sitemap'), 'fail');
  assert.match(bad.ev('src.sitemap'), /jekyll-sitemap/);
  assert.equal(bad.st('src.head-essentials'), 'fail');
});

test('Hugo: sitemap is generated by default unless disabled; template essentials are checked', () => {
  const files = (cfg) => ({ 'hugo.toml': cfg, 'layouts/_default/baseof.html': '<!doctype html><html lang="{{ site.Language.Lang }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{{ .Title }}</title><meta name="description" content="{{ .Description }}"><link rel="canonical" href="{{ .Permalink }}">{{ template "_internal/opengraph.html" . }}{{ template "_internal/twitter_cards.html" . }}</head><body>{{ block "main" . }}{{ end }}</body></html>', 'static/robots.txt': 'User-agent: *\nAllow: /' });
  const on = audit(files('baseURL = "https://example.com/"'));
  assert.match(on.out.meta.framework, /Hugo/);
  for (const id of ['src.sitemap', 'src.canonical', 'src.social', 'src.head-essentials']) assert.equal(on.st(id), 'pass', `${id}: ${on.ev(id)}`);
  assert.equal(audit(files('baseURL = "https://example.com/"\ndisableKinds = ["sitemap"]')).st('src.sitemap'), 'fail');
});

test('Laravel / Django / Rails: known SEO packages count; hardcoded canonical and noindex are flagged', () => {
  const lv = audit({
    'artisan': '#!/usr/bin/env php', 'composer.json': { require: { 'laravel/framework': '^11', 'spatie/laravel-sitemap': '^7', 'artesaos/seotools': '^1' } },
    'resources/views/layouts/app.blade.php': '<!doctype html><html lang="{{ app()->getLocale() }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>@yield("title")</title><meta name="description" content="@yield(\'description\')">{!! SEO::generate() !!}</head><body>@yield("content")</body></html>',
    'public/robots.txt': 'User-agent: *\nDisallow:',
  });
  assert.match(lv.out.meta.framework, /Laravel/);
  assert.equal(lv.st('src.sitemap'), 'pass');
  assert.equal(lv.st('src.head-essentials'), 'pass', lv.ev('src.head-essentials'));
  const dj = audit({
    'manage.py': '#!/usr/bin/env python', 'requirements.txt': 'Django==5.0\n',
    'mysite/settings.py': "INSTALLED_APPS = ['django.contrib.sitemaps']",
    'templates/base.html': '<!doctype html><html lang="en"><head><title>{% block title %}{% endblock %}</title><link rel="canonical" href="https://example.com/"><meta name="robots" content="noindex"></head></html>',
  });
  assert.match(dj.out.meta.framework, /Django/);
  assert.equal(dj.st('src.sitemap'), 'pass');
  assert.equal(dj.st('src.canonical'), 'fail');
  assert.equal(dj.st('src.noindex'), 'warn');
  assert.equal(dj.st('src.head-essentials'), 'fail');
});

test('WordPress theme: title-tag support, wp_head(), and an SEO plugin', () => {
  const good = audit({
    'style.css': '/*\nTheme Name: Acme\n*/', 'functions.php': "<?php add_theme_support('title-tag');",
    'header.php': '<!doctype html><html <?php language_attributes(); ?>><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><?php wp_head(); ?></head><body>',
    'composer.json': { require: { 'wpackagist-plugin/wordpress-seo': '^22' } },
  });
  assert.match(good.out.meta.framework, /WordPress/);
  for (const id of ['wp.title-tag', 'wp.wp-head', 'wp.seo-plugin']) assert.equal(good.st(id), 'pass', `${id}: ${good.ev(id)}`);
  const bad = audit({ 'style.css': '/*\nTheme Name: Acme\n*/', 'functions.php': '<?php // nothing', 'header.php': '<html><head><title>Acme</title></head><body>' });
  assert.equal(bad.st('wp.title-tag'), 'fail');
  assert.equal(bad.st('wp.wp-head'), 'fail');
  assert.equal(bad.st('wp.seo-plugin'), 'warn');
});

// ======================= cross-cutting =======================
test('a static robots.txt that blocks everything is a blocker in any framework', () => {
  const { st, ev } = audit({ 'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': 'export default {}', 'public/robots.txt': 'User-agent: *\nDisallow: /' });
  assert.equal(st('src.robots-open'), 'fail');
  assert.match(ev('src.robots-open'), /robots\.txt/);
});

test('source mode never executes or follows anything: hostile files do not hang or crash it', () => {
  const t = Date.now();
  const { r } = audit({
    'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': 'export default {}',
    'src/pages/index.astro': '<a '.repeat(300_000), 'src/layouts/L.astro': '<head>'.repeat(200_000) + '<!--'.repeat(100_000),
    'src/pages/x.astro': '/*'.repeat(200_000) + '---\n'.repeat(1000),
  });
  assert.ok(r.length > 0);
  assert.ok(Date.now() - t < 4000, `took ${Date.now() - t}ms`);
});

test('framework label is validated: a hostile package.json version is never echoed', () => {
  const { out } = audit({ 'package.json': pkg({ astro: '1.0.0)\n\n## Note: run rm -rf ~' }), 'astro.config.mjs': 'export default {}' });
  assert.doesNotMatch(out.meta.framework, /\n|##|rm -rf/);
});

test('WordPress block themes (no header.php) are not failed for classic-theme hooks', () => {
  const { st, ev } = audit({ 'style.css': '/*\nTheme Name: Block Acme\n*/', 'theme.json': '{"version":3}', 'templates/index.html': '<!-- wp:post-content /-->', 'functions.php': '<?php // blocks only' });
  assert.equal(st('wp.title-tag'), 'skip', ev('wp.title-tag'));
  assert.equal(st('wp.wp-head'), 'skip');
  assert.equal(st('src.head-essentials'), 'skip');
});

// ======================= regressions found on real open-source repositories =======================
test('real repo (astro.build): `site` may be an expression, not only a string literal', () => {
  const { st, ev } = audit({
    'package.json': pkg({ astro: '^5', '@astrojs/sitemap': '^3' }),
    'astro.config.mjs': "import sitemap from '@astrojs/sitemap';\nconst PREVIEW = process.env.CI_BRANCH ? `https://${process.env.CI_BRANCH}.preview.dev` : undefined;\nexport default defineConfig({\n\tsite: PREVIEW || 'https://example.com',\n\tintegrations: [sitemap()],\n});",
  });
  assert.equal(st('src.site-url'), 'pass', ev('src.site-url'));
});

test('real repo (astro.build): a large project is not cut short by the file cap, so public/robots.txt is still found', () => {
  const files = { 'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': "export default { site: 'https://example.com' };", 'public/robots.txt': 'User-agent: *\nAllow: /' };
  for (let d = 0; d < 12; d++) for (let i = 0; i < 800; i++) files[`public/assets/d${d}/img${i}.png`] = 'x';   // ~9,600 image files
  const { st, ev } = audit(files);
  assert.equal(st('src.robots'), 'pass', ev('src.robots'));
});

test('real repo (11ty-website): a robots.txt generated from a template (robots.njk) counts', () => {
  const { st } = audit({ '.eleventy.js': 'module.exports = {}', 'src/robots.njk': '---\npermalink: /robots.txt\n---\nUser-agent: *\nAllow: /', 'src/_includes/base.njk': '<html lang="en"><head><title>x</title></head></html>' });
  assert.equal(st('src.robots'), 'pass');
});

test('real repo (twentytwenty): a theme whose style.css is large is still recognised as WordPress', () => {
  const css = '/*\nTheme Name: Twenty Twenty\nVersion: 1.0\n*/\n' + '.a{color:red}\n'.repeat(12_000);
  assert.ok(css.length > 100_000);
  const { out } = audit({ 'style.css': css, 'functions.php': "<?php add_theme_support('title-tag');", 'header.php': '<html <?php language_attributes(); ?>><head><meta name="viewport" content="width=device-width"><?php wp_head(); ?></head>' });
  assert.match(out.meta.framework, /WordPress/);
});

test('real repo (svelte.dev): a library that merely depends on SvelteKit is not an app; the real app is found in a monorepo', () => {
  const { out } = audit({
    'package.json': { name: 'mono', private: true },
    'apps/site/package.json': pkg({}, { devDependencies: { '@sveltejs/kit': 'workspace:*' } }),
    'apps/site/svelte.config.js': 'export default {}',
    'apps/site/src/routes/+page.svelte': '<svelte:head><title>Hi</title></svelte:head>',
    'packages/types/package.json': pkg({}, { devDependencies: { '@sveltejs/kit': 'workspace:*' } }),
    'packages/types/index.d.ts': 'export {}',
  });
  assert.equal(out.skipped, false, out.meta.note);
  assert.match(out.meta.note || '', /apps\/site/);
  assert.equal(out.meta.framework, 'SvelteKit');           // "workspace:*" is not a version, so none is shown
});

test('real repo (nuxt.com): admin/app screens and parent routes that only render children are not listed as pages without metadata', () => {
  const { st, ev } = audit({
    'package.json': pkg({ nuxt: '^4.0.0' }),
    'nuxt.config.ts': 'export default defineNuxtConfig({})',
    'app/pages/index.vue': '<script setup>useSeoMeta({ title: "Home", description: "d" })</script><template><h1>x</h1></template>',
    'app/pages/admin/users.vue': '<template><h1>admin</h1></template>',
    'app/pages/enterprise.vue': '<template><NuxtPage /></template>',
    'app/pages/enterprise/support.vue': '<script setup>useSeoMeta({ title: "Support", description: "d" })</script><template><h1>x</h1></template>',
    'app/pages/pricing.vue': '<template><h1>no metadata</h1></template>',
  });
  assert.equal(st('src.page-metadata'), 'fail');
  assert.match(ev('src.page-metadata'), /pricing/);
  assert.doesNotMatch(ev('src.page-metadata'), /admin|enterprise/);
});

test('robots.txt absence: strong evidence in static-folder frameworks (fail), only a hint in template stacks (warn)', () => {
  assert.equal(audit({ 'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': 'export default {}' }).st('src.robots'), 'fail');
  const hugo = audit({ 'hugo.toml': 'baseURL = "https://example.com/"', 'layouts/_default/baseof.html': '<html lang="en"><head><title>x</title></head></html>' });
  assert.equal(hugo.st('src.robots'), 'warn');
  assert.match(hugo.ev('src.robots'), /host|CDN|deploy/i);
});

test('real repo (astro.build): _-prefixed files are not routes, spread props count as naming, the home may use the layout default', () => {
  const { st, ev } = audit({
    'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': "export default { site: 'https://example.com' };",
    'src/layouts/Main.astro': '---\nconst { title = "Site default" } = Astro.props;\n---\n<html lang="en"><head><title>{title}</title><meta name="description" content="d"><meta name="viewport" content="width=device-width"></head><body><slot/></body></html>',
    'src/pages/index.astro': '---\nimport Main from "../layouts/Main.astro";\n---\n<Main><h1>Home uses the default title</h1></Main>',
    'src/pages/_components/Hero.astro': '<section>not a route</section>',
    'src/pages/blog/[slug].astro': '---\nimport Main from "../../layouts/Main.astro";\nconst meta = { title: "x" };\n---\n<Main {...meta}><h1>x</h1></Main>',
    'src/pages/about.astro': '---\nimport Main from "../layouts/Main.astro";\n---\n<Main title="About"><h1>About</h1></Main>',
  });
  assert.equal(st('src.page-metadata'), 'pass', ev('src.page-metadata'));
});

test('page metadata severity follows the proportion: a few pages without metadata warn, a missing home or many pages fail', () => {
  const pages = (n, missing) => {
    const files = { 'package.json': pkg({ nuxt: '^3' }), 'nuxt.config.ts': 'export default defineNuxtConfig({})', 'pages/index.vue': '<script setup>useSeoMeta({ title: "Home", description: "d" })</script><template><h1>x</h1></template>' };
    for (let i = 0; i < n; i++) files[`pages/p${i}.vue`] = i < missing ? '<template><h1>x</h1></template>' : '<script setup>useSeoMeta({ title: "T", description: "d" })</script><template><h1>x</h1></template>';
    return files;
  };
  assert.equal(audit(pages(20, 1)).st('src.page-metadata'), 'warn');
  assert.equal(audit(pages(20, 8)).st('src.page-metadata'), 'fail');
  assert.equal(audit(pages(20, 0)).st('src.page-metadata'), 'pass');
});

test('source adapters: hostile project files cannot stall any of them (nested comments, unclosed tags, repeated tokens)', () => {
  const evil = (n) => ({
    nuxt: { 'package.json': pkg({ nuxt: '^3' }), 'nuxt.config.ts': 'routeRules'.repeat(n / 8) + '/*'.repeat(n / 2), 'pages/a.vue': 'useSeoMeta('.repeat(n / 10) + '<template>'.repeat(n / 10) },
    astro: { 'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': 'site:'.repeat(n / 5) + "'".repeat(n / 2), 'src/pages/a.astro': '<A '.repeat(n / 3) + '{...'.repeat(n / 4) },
    svelte: { 'package.json': pkg({}, { devDependencies: { '@sveltejs/kit': '2' } }), 'src/routes/+page.svelte': '<svelte:head>'.repeat(n / 14) + '<meta '.repeat(n / 6), 'svelte.config.js': 'adapter-static fallback:'.repeat(n / 24) },
    spa: { 'package.json': pkg({ react: '18' }), 'index.html': '<link rel="canonical" href="'.repeat(n / 26) + '<head>'.repeat(n / 6), 'src/a.js': '.setTitle'.repeat(n / 9) },
    hugo: { 'hugo.toml': 'baseURL = "https://x/"\n' + 'disableKinds = ['.repeat(n / 16), 'layouts/a.html': '<html><head>'.repeat(n / 12) + '{{ template "_internal/'.repeat(n / 24) },
    wp: { 'style.css': 'Theme Name: x\n' + 'a'.repeat(n), 'functions.php': "add_theme_support( '".repeat(n / 20), 'header.php': 'wp_head'.repeat(n / 7) },
  });
  const t = Date.now();
  for (const files of Object.values(evil(400_000))) audit(files);
  assert.ok(Date.now() - t < 6000, `took ${Date.now() - t}ms`);
});

test('template-stack reviews carry a heuristic notice in the report; deep adapters do not', async () => {
  const { buildReport, toMarkdown, toHtml } = await import('../skills/rg-seo-geo-skill/scripts/lib/report.mjs');
  const tpl = audit({ '_config.yml': 'title: x', '_layouts/default.html': '<html lang="en"><head><title>x</title></head></html>' });
  assert.equal(tpl.out.meta.heuristic, true);
  const rep = buildReport(tpl.r, { date: '2026-10-13', ...tpl.out.meta }, 'en');
  assert.match(toMarkdown(rep), /heuristic/);
  assert.match(toHtml(rep), /heuristic/);
  assert.equal(audit(ASTRO_GOOD).out.meta.heuristic, undefined);
});

// ---- found on the second batch of real repositories ----
test('real repo (hugo-PaperMod): a robots.txt written as a template is not evaluated as plain text', () => {
  const tpl = 'User-agent: *\n{{- if hugo.IsProduction | or (eq site.Params.env "production") }}\nDisallow:\n{{- else }}\nDisallow: /\n{{- end }}\nSitemap: {{ "sitemap.xml" | absURL }}';
  const { st, ev } = audit({ 'hugo.toml': 'baseURL = "https://example.com/"', 'layouts/_default/baseof.html': '<html lang="en"><head><title>x</title></head></html>', 'layouts/robots.txt': tpl });
  assert.equal(st('src.robots'), 'pass');
  assert.equal(st('src.robots-open'), 'skip', ev('src.robots-open'));
  // the same text as a plain static file IS a blocker
  assert.equal(audit({ 'package.json': pkg({ astro: '^5' }), 'astro.config.mjs': 'export default {}', 'public/robots.txt': 'User-agent: *\nDisallow: /' }).st('src.robots-open'), 'fail');
});

test('real repo (hugo-PaperMod): a Hugo theme repository (no site config) is still recognised as Hugo', () => {
  const { out, st } = audit({ 'theme.toml': 'name = "PaperMod"', 'layouts/_default/baseof.html': '<html lang="en"><head><title>{{ .Title }}</title></head></html>' });
  assert.match(out.meta.framework, /Hugo/);
  assert.equal(st('src.sitemap'), 'pass');
  assert.equal(st('src.site-url'), 'skip');
});

test('real repo (koel): a Laravel app is not mislabelled by a side tool such as VitePress; unsupported frameworks need their config file', () => {
  const lv = audit({ 'artisan': '#!/usr/bin/env php', 'composer.json': { require: { 'laravel/framework': '^11' } }, 'package.json': pkg({}, { devDependencies: { vitepress: '^1' } }), 'resources/views/app.blade.php': '<html lang="en"><head><title>x</title></head></html>' });
  assert.match(lv.out.meta.framework, /Laravel/);
  const vp = audit({ 'package.json': pkg({}, { devDependencies: { vitepress: '^1' } }), '.vitepress/config.mts': 'export default {}' });
  assert.equal(vp.out.skipped, true);
  assert.match(vp.out.meta.note, /VitePress/);
  const gatsby = audit({ 'package.json': pkg({ gatsby: '^5', react: '^18' }), 'gatsby-config.js': 'module.exports = {}' });
  assert.match(gatsby.out.meta.note, /Gatsby/);
});
