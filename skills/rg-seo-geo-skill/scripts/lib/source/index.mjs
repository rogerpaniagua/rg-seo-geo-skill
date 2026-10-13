// Source-code review dispatcher: finds out what kind of project a folder is and runs the right adapter.
//
//   Next.js          deep review (lib/next-checks.mjs)
//   Astro, Nuxt, SvelteKit, client-rendered SPAs (Vite/CRA/Vue CLI/Angular CLI)   deep review (this folder)
//   Jekyll, Hugo, Eleventy, Laravel, Django, Rails, WordPress themes, plain PHP/HTML   template heuristics
//   anything else    a clear note pointing at --url / --build, which work for every stack
//
// Nothing here executes project code. A monorepo is handled by looking one or two levels down.

import fs from 'node:fs';
import path from 'node:path';
import { walk, readJson, allDeps, hasDep, withVersion, relPath, sanitize } from './common.mjs';
import { runNextAudit } from '../next-checks.mjs';
import { detectAstro, auditAstro } from './astro.mjs';
import { detectNuxt, auditNuxt } from './nuxt.mjs';
import { detectSvelteKit, auditSvelteKit } from './sveltekit.mjs';
import { detectSpa, auditSpa } from './spa.mjs';
import { detectTemplates, auditTemplates } from './templates.mjs';

// Frameworks we recognise but do not review at code level yet. A dependency alone is not enough (a Laravel app may carry
// VitePress for its docs), so each needs its own config file as evidence.
const UNSUPPORTED = [
  [/^gatsby$/, 'Gatsby', /^gatsby-config\.\w+$/],
  [/^@remix-run\/(node|react|serve|dev)$/, 'Remix', /^(remix\.config\.\w+|app\/root\.(tsx|jsx))$/],
  [/^@react-router\/(dev|node|serve)$/, 'React Router (framework mode)', /^react-router\.config\.\w+$/],
  [/^(solid-start|@solidjs\/start)$/, 'SolidStart', /^app\.config\.\w+$/],
  [/^@builder\.io\/qwik-city$/, 'Qwik City', /^src\/routes\//],
  [/^@docusaurus\/core$/, 'Docusaurus', /^docusaurus\.config\.\w+$/],
  [/^vitepress$/, 'VitePress', /^\.vitepress\//],
  [/^@tanstack\/(react-)?start$/, 'TanStack Start', /^(app\.config\.\w+|src\/router\.\w+)$/],
  [/^@angular\/ssr$/, 'Angular SSR', /^angular\.json$/],
];
const BACKEND_TEMPLATES = new Set(['WordPress', 'Laravel', 'Django', 'Rails']);

const NOT_AVAILABLE = (name) => `Detected ${name}. Code-level review is not available for it yet. The published site (--url) or the compiled output (--build) can be audited for any framework.`;

/** Describe the project at `root`, or null. `strong` is false for the generic PHP/HTML fallback. */
function inspect(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = allDeps(pkg);
  if ('next' in deps) return { kind: 'next', label: withVersion('Next.js', deps.next), strong: true };
  const files = walk(root);
  const base = { root, pkg, deps, files };
  if (detectAstro(root, deps)) return { ...base, kind: 'astro', label: withVersion('Astro', deps.astro), strong: true, audit: auditAstro };
  if (detectNuxt(root, deps)) return { ...base, kind: 'nuxt', label: withVersion('Nuxt', deps.nuxt || deps.nuxt3), strong: true, audit: auditNuxt };
  if (detectSvelteKit(root, deps)) return { ...base, kind: 'sveltekit', label: withVersion('SvelteKit', deps['@sveltejs/kit']), strong: true, audit: auditSvelteKit };
  // A server-side backend decides the HTML, so it wins over side tooling that happens to be in package.json.
  const t = detectTemplates(root, files);
  const templates = t && { ...base, ...t, kind: 'templates', label: t.kind, strong: !['PHP', 'Static HTML'].includes(t.kind), audit: (ctx, c) => auditTemplates({ ...ctx, ...t }, c) };
  if (t && BACKEND_TEMPLATES.has(t.kind)) return templates;
  const rel = (f) => relPath(root, f);
  for (const [re, name, marker] of UNSUPPORTED) {
    if (hasDep(deps, re) && files.some((f) => marker.test(rel(f)))) return { ...base, kind: 'unsupported', label: name, strong: true, note: NOT_AVAILABLE(name) };
  }
  if (detectSpa(root, deps, files)) {
    const ui = hasDep(deps, /^react$/) ? 'React' : hasDep(deps, /^vue$/) ? 'Vue' : hasDep(deps, /^svelte$/) ? 'Svelte' : hasDep(deps, /^@angular\/core$/) ? 'Angular' : hasDep(deps, /^preact$/) ? 'Preact' : hasDep(deps, /^solid-js$/) ? 'Solid' : 'JavaScript';
    return { ...base, kind: 'spa', label: `${ui} single-page app (client-rendered)`, strong: true, audit: auditSpa };
  }
  return templates || null;
}

/** Look one or two levels below `root` for projects (monorepos: apps/web, packages/site...). */
function findChildren(root) {
  const out = [];
  const scan = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'out', 'vendor', 'coverage'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      const found = inspect(full);
      if (found && found.strong) out.push(found);
      else if (depth < 2) scan(full, depth + 1);
      if (out.length > 20) return;
    }
  };
  scan(root, 1);
  return out;
}

/** Entry point used by the CLI for --src. Same return shape as runNextAudit: { skipped, meta }. */
export function runSourceAudit({ src }, c, log = () => {}) {
  const root = path.resolve(src);
  let st;
  try { st = fs.statSync(root); } catch { throw new Error(`Source directory not found: ${root}`); }
  if (!st.isDirectory()) throw new Error(`--src must be a directory: ${src}`);

  let found = inspect(root);
  let note;
  if (!found || !found.strong) {
    const children = findChildren(root);
    if (children.length === 1) { found = children[0]; note = `Found the project in ${relPath(root, children[0].root)}`; }
    else if (children.length > 1) {
      const list = children.slice(0, 6).map((x) => `${relPath(root, x.root)} (${x.label})`).join(', ');
      return { skipped: true, meta: { src: sanitize(path.basename(root), 80), framework: null, note: sanitize(`Several projects found: ${list}. Point --src at one of them.`, 400) } };
    }
  }
  if (!found) {
    return { skipped: true, meta: { src: sanitize(path.basename(root), 80), framework: null, note: 'No supported project structure found in this folder. Audit the published site with --url, or the compiled output with --build: both work for any framework.' } };
  }
  if (found.kind === 'next') {
    const r = runNextAudit({ src: found.root || root }, c, log);
    if (note) r.meta.note = note;
    return r;
  }
  if (found.kind === 'unsupported') {
    return { skipped: true, meta: { src: sanitize(path.basename(found.root), 80), framework: sanitize(found.label, 60), note: found.note } };
  }
  log(`${found.label} detected in ${relPath(root, found.root) || '.'}`);
  const result = found.audit({ root: found.root, pkg: found.pkg, deps: found.deps, files: found.files }, c);
  return {
    skipped: false,
    meta: {
      src: sanitize(path.basename(found.root), 80),
      framework: sanitize(found.label, 80),
      note: note ? sanitize(note, 200) : undefined,
      heuristic: found.kind === 'templates' ? true : undefined,
      ...(result || {}),
    },
  };
}
