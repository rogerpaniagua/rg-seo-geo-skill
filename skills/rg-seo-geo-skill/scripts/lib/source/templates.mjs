// Template-based stacks: Jekyll, Hugo, Eleventy, Laravel (Blade), Django, Rails, WordPress themes, plain PHP/HTML.
// Each organises templates differently, so this review is deliberately a *heuristic*: it looks for the head
// essentials across all template files, and for the sitemap/robots/404 conventions of each stack.

import fs from 'node:fs';
import path from 'node:path';
import { read, readHead, readJson, relPath, headFacts, evalHead, evalRobotsOpen, evidenceList, hasDep, allDeps } from './common.mjs';

const TEMPLATE_EXT = /\.(html|htm|njk|liquid|hbs|handlebars|ejs|twig|jinja2?|j2|erb|php|phtml|mustache)$/i;
const SKIP_DIRS = /(^|\/)(tests?|spec|__tests__|fixtures|examples?)\//i;
const WP_SEO_PLUGINS = /wordpress-seo|yoast|seo-by-rank-math|rank-math|wp-seopress|seopress|all-in-one-seo|autodescription|the-seo-framework/i;

export function detectTemplates(root, files) {
  const rel = (f) => relPath(root, f);
  const has = (re) => files.some((f) => re.test(rel(f)));
  const hasFile = (name) => fs.existsSync(path.join(root, name));
  const composer = readJson(path.join(root, 'composer.json'));
  const require = composer && typeof composer.require === 'object' ? { ...composer.require, ...(composer['require-dev'] || {}) } : {};
  const gemfile = read(path.join(root, 'Gemfile'), 100_000);

  const themes = files.filter((f) => /(^|\/)style\.css$/.test(rel(f)) && /Theme Name\s*:/.test(readHead(f, 6000)));
  if (themes.length) return { kind: 'WordPress', themeDirs: [...new Set(themes.map((f) => path.dirname(f)))] };
  if (hasFile('artisan') && 'laravel/framework' in require) return { kind: 'Laravel' };
  if (hasFile('manage.py')) return { kind: 'Django' };
  if (/\bgem\s+['"]rails['"]/.test(gemfile) && hasFile('config/application.rb')) return { kind: 'Rails' };
  if ((hasFile('_config.yml') || hasFile('_config.yaml')) && (has(/^_layouts\//) || /jekyll/.test(gemfile))) return { kind: 'Jekyll' };
  const hugoCfg = ['hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json', 'config.toml', 'config.yaml', 'config.yml', 'config.json'].find((n) => hasFile(n) && /baseURL/i.test(read(path.join(root, n), 50_000)));
  if (hugoCfg && (has(/^layouts\//) || has(/^themes\//))) return { kind: 'Hugo', hugoCfg };
  // a Hugo theme repository: no site config of its own, but theme.toml and layouts/
  if (hasFile('theme.toml') && has(/^layouts\//)) return { kind: 'Hugo', hugoCfg: undefined, theme: true };
  if (['.eleventy.js', 'eleventy.config.js', 'eleventy.config.cjs', 'eleventy.config.mjs'].some(hasFile)) return { kind: 'Eleventy' };
  const anyTemplate = files.some((f) => TEMPLATE_EXT.test(f) && !SKIP_DIRS.test(rel(f)) && /<html[\s>]|<head[\s>]/i.test(read(f, 120_000)));
  if (anyTemplate) return { kind: files.some((f) => f.endsWith('.php')) ? 'PHP' : 'Static HTML' };
  return null;
}

export function auditTemplates({ root, files, pkg, kind, themeDirs, hugoCfg }, c) {
  const rel = (f) => relPath(root, f);
  const scope = kind === 'WordPress' ? files.filter((f) => themeDirs.some((d) => f.startsWith(d + path.sep))) : files;
  const templates = scope.filter((f) => TEMPLATE_EXT.test(f) && !SKIP_DIRS.test(rel(f))).slice(0, 500);
  const has = (re) => files.find((f) => re.test(rel(f)));
  const composer = readJson(path.join(root, 'composer.json'));
  const phpDeps = composer && typeof composer.require === 'object' ? { ...composer.require, ...(composer['require-dev'] || {}) } : {};
  const gemfile = read(path.join(root, 'Gemfile'), 100_000);
  const jsDeps = allDeps(pkg);
  const text = (name) => read(path.join(root, name), 200_000);
  const hugoConfig = hugoCfg ? text(hugoCfg) : '';
  const jekyllConfig = text('_config.yml') || text('_config.yaml');

  const facts = headFacts(templates.map((f) => ({ file: rel(f), text: read(f, 300_000) })));

  // ---------- WordPress ----------
  let wpHints = {};
  if (kind === 'WordPress') {
    const functionsPhp = scope.filter((f) => /(^|\/)functions\.php$/.test(rel(f))).map((f) => read(f)).join('\n');
    const phpTexts = scope.filter((f) => f.endsWith('.php')).map((f) => read(f, 200_000));
    // Block (full-site-editing) themes have no header.php: WordPress renders the document title for block templates by itself
    // (WordPress reference: _block_template_render_title_tag), so the classic-theme hooks do not apply.
    const isBlockTheme = themeDirs.some((d) => fs.existsSync(path.join(d, 'theme.json')) && fs.existsSync(path.join(d, 'templates', 'index.html')) && !fs.existsSync(path.join(d, 'header.php')));
    const titleTag = /add_theme_support\s*\(\s*['"]title-tag['"]/.test(functionsPhp);
    const wpHead = phpTexts.some((t) => /\bwp_head\s*\(/.test(t));
    const seoPlugin = files.some((f) => /(^|\/)wp-content\/plugins\//.test(rel(f)) && WP_SEO_PLUGINS.test(rel(f).split('/')[2] || '')) || Object.keys(phpDeps).some((n) => WP_SEO_PLUGINS.test(n));
    if (isBlockTheme) {
      c.add('wp.title-tag', 'skip', 'block theme: WordPress core renders the document title for block templates');
      c.add('wp.wp-head', 'skip', 'block theme: it has no header.php; the page head is built by WordPress core');
    } else {
    c.add('wp.title-tag', titleTag ? 'pass' : 'fail', titleTag ? "add_theme_support('title-tag') found" : "the theme does not declare add_theme_support('title-tag') in functions.php (hook it on after_setup_theme): WordPress cannot manage the document title");
    c.add('wp.wp-head', wpHead ? 'pass' : 'fail', wpHead ? 'wp_head() is called' : 'no wp_head() call in the theme: plugins (SEO, schema, social) have nowhere to output their tags');
    }
    c.add('wp.seo-plugin', seoPlugin ? 'pass' : 'warn', seoPlugin ? 'an SEO plugin is part of this project' : 'no SEO plugin (Yoast SEO, Rank Math, SEOPress) in this repository. It may be installed on the live site: the URL audit shows what is actually served');
    if (titleTag && !facts.title.length) facts.title.push('title-tag theme support');
    if (seoPlugin) for (const k of ['description', 'canonical', 'og', 'twitter', 'jsonld']) if (!facts[k].length) facts[k].push('SEO plugin');
    wpHints = { head: 'In WordPress the title comes from title-tag support and the description from an SEO plugin.', skipEssentials: isBlockTheme ? 'block theme: the head is generated by WordPress core and plugins, so it cannot be judged from theme files' : undefined };
  }

  // ---------- head essentials, canonical, social, schema, noindex ----------
  const hints = {
    Jekyll: { head: 'Use {% seo %} (jekyll-seo-tag) in your layout, or write the tags by hand.', canonical: '<link rel="canonical" href="{{ page.url | absolute_url }}">' },
    Hugo: { head: 'Write them in layouts/_default/baseof.html: {{ .Title }}, {{ .Description }}, {{ .Permalink }}.', canonical: '<link rel="canonical" href="{{ .Permalink }}">', social: 'Add {{ template "_internal/opengraph.html" . }} and {{ template "_internal/twitter_cards.html" . }}.' },
    Laravel: { head: 'Put them in your Blade layout, or use a package such as artesaos/seotools.', canonical: '<link rel="canonical" href="{{ url()->current() }}">' },
    Django: { head: 'Put them in templates/base.html with {% block %} per page.', canonical: '<link rel="canonical" href="{{ request.build_absolute_uri }}">' },
    Rails: { head: 'Put them in app/views/layouts/application.html.erb, or use the meta-tags gem.', canonical: '<link rel="canonical" href="<%= request.original_url.split(\'?\').first %>">' },
  }[kind] || {};
  evalHead(c, facts, { skipEssentials: wpHints.skipEssentials, hint: { head: wpHints.head || hints.head || '', canonical: hints.canonical ? `Build it per page, e.g. ${hints.canonical}` : 'Build it per page.', social: hints.social || '', jsonld: '' } });

  // ---------- sitemap ----------
  const sitemapFile = files.find((f) => /(^|\/)sitemap[^/]*\.xml(\.\w+)?$/i.test(rel(f)) || /(^|\/)sitemap[^/]*\.(njk|liquid|erb|twig|blade\.php)$/i.test(rel(f)));
  const sitemapDep = Object.keys({ ...phpDeps, ...jsDeps }).some((n) => /sitemap/i.test(n));
  let sm;
  if (sitemapFile) sm = ['pass', rel(sitemapFile)];
  else if (kind === 'Jekyll') {
    if (/jekyll-sitemap/.test(jekyllConfig)) sm = ['pass', 'jekyll-sitemap listed in _config.yml'];
    else if (/jekyll-sitemap/.test(gemfile)) sm = ['warn', 'jekyll-sitemap is in the Gemfile but not under `plugins:` in _config.yml. Per its docs the plugin does not work with only the Gemfile entry'];
    else sm = ['fail', "no sitemap. Add gem 'jekyll-sitemap' to the Gemfile AND `- jekyll-sitemap` under plugins in _config.yml (it also needs `url:` set)"];
  } else if (kind === 'Hugo') {
    const disabled = /disableKinds\s*[=:]\s*\[[^\]]{0,300}["']sitemap["']/.test(hugoConfig);
    sm = disabled ? ['fail', 'sitemap is disabled in disableKinds; remove it so Hugo generates sitemap.xml'] : ['pass', 'Hugo generates sitemap.xml by default'];
  } else if (kind === 'WordPress') sm = ['pass', 'WordPress core serves /wp-sitemap.xml (5.5+) unless a plugin replaces or disables it'];
  else if (kind === 'Django') {
    const py = files.filter((f) => f.endsWith('.py')).slice(0, 300);
    sm = py.some((f) => read(f, 100_000).includes('django.contrib.sitemaps')) ? ['pass', 'django.contrib.sitemaps'] : ['fail', "no sitemap. Add 'django.contrib.sitemaps' to INSTALLED_APPS and a sitemap view in urls.py"];
  } else if (kind === 'Rails') sm = /sitemap_generator|sitemap_rails|rails-sitemap/.test(gemfile) || has(/^config\/sitemap\.rb$/) ? ['pass', 'sitemap generator'] : ['fail', "no sitemap. Add the sitemap_generator gem (config/sitemap.rb) or a public/sitemap.xml"];
  else if (kind === 'Laravel') sm = sitemapDep ? ['pass', 'sitemap package'] : ['fail', 'no sitemap. Add spatie/laravel-sitemap or a public/sitemap.xml'];
  else sm = sitemapDep ? ['pass', 'sitemap package'] : ['fail', 'no sitemap.xml found'];
  c.add('src.sitemap', sm[0], sm[1]);

  // ---------- robots ----------
  const robotsFile = files.filter((f) => /(^|\/)robots\.txt$/.test(rel(f))).sort((a, b) => rel(a).length - rel(b).length)[0];
  // robots.txt rendered from a template (Eleventy robots.njk, Rails robots.txt.erb, Laravel route...)
  const robotsTemplate = files.find((f) => /(^|\/)robots\.(njk|liquid|html|md|11ty\.js|erb|php|twig|ejs|hbs|txt\.\w+)$/i.test(rel(f)) && !/(^|\/)content\//.test(rel(f)));
  const hugoRobots = kind === 'Hugo' && /enableRobotsTXT\s*[=:]\s*true/i.test(hugoConfig);
  if (robotsFile) { c.add('src.robots', 'pass', rel(robotsFile)); evalRobotsOpen(c, read(robotsFile), rel(robotsFile)); }
  else if (robotsTemplate) c.add('src.robots', 'pass', `${rel(robotsTemplate)} (generated from a template)`);
  else if (hugoRobots) c.add('src.robots', 'pass', 'enableRobotsTXT = true');
  else if (kind === 'WordPress') c.add('src.robots', 'pass', 'WordPress serves a virtual robots.txt (check its output on the live site)');
  // Template stacks often get robots.txt from the host or CDN, which a source review cannot see: a hint, not a failure.
  else c.add('src.robots', 'warn', 'no robots.txt in this project. If your host or CDN does not add one, add it (with a Sitemap: line)' + (kind === 'Hugo' ? ', or set enableRobotsTXT = true' : '') + '. The URL audit shows what is actually served.');

  // ---------- site URL ----------
  if (kind === 'Hugo' && !hugoCfg) c.add('src.site-url', 'skip', 'theme repository: baseURL belongs to the site that uses the theme');
  else if (kind === 'Jekyll') {
    const hasUrl = /^url\s*:\s*["']?https?:\/\//m.test(jekyllConfig);
    c.add('src.site-url', hasUrl ? 'pass' : 'warn', hasUrl ? 'url set in _config.yml' : 'no `url:` in _config.yml. jekyll-sitemap and absolute_url need it: url: "https://your-domain.com"');
  } else if (kind === 'Hugo') {
    const hasBase = /baseURL\s*[=:]\s*["']https?:\/\//i.test(hugoConfig);
    c.add('src.site-url', hasBase ? 'pass' : 'warn', hasBase ? 'baseURL set' : 'no absolute baseURL: canonical and sitemap URLs will be wrong');
  } else c.add('src.site-url', 'skip', 'not applicable');

  // ---------- 404 ----------
  const nf = files.find((f) => /(^|\/)404\.[a-z.]+$/i.test(rel(f)) || /errors\/404\./i.test(rel(f)));
  c.add('src.not-found', nf ? 'pass' : 'warn', nf ? rel(nf) : 'no 404 template found: add one so unknown URLs return a helpful page with a real 404 status');
  return { templates: templates.length };
}
