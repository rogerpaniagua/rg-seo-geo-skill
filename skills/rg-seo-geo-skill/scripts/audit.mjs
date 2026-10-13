#!/usr/bin/env node
// SEO & GEO audit CLI. Zero dependencies, Node 18+.
//
//   node audit.mjs --url https://example.com [--src ./project] [--out ./seo-geo-report]
//                  [--pages 6] [--lang es|en] [--allow-local] [--fail-on blocker|important]
//
// Writes report.html, report.md and audit.json into --out. Exit code 1 when --fail-on is hit.

import fs from 'node:fs';
import path from 'node:path';
import { Collector, sanitize } from './lib/collector.mjs';
import { runUrlAudit } from './lib/url-checks.mjs';
import { runNextAudit } from './lib/next-checks.mjs';
import { serveStatic } from './lib/static-server.mjs';
import { buildReport, toHtml, toMarkdown } from './lib/report.mjs';

const HELP = `rg-seo-geo-skill

Usage:
  node audit.mjs --url <https://site> [options]
  node audit.mjs --src <project-dir> [options]
  node audit.mjs --url <https://site> --src <project-dir>      (both)
  node audit.mjs --build <compiled-dir>                         (before deploying; any stack)

Options:
  --url <url>          Published site (or local dev server with --allow-local). Works for any stack.
  --src <dir>          Source code to inspect (Next.js App Router supported).
  --build <dir>        Compiled site folder (dist, out, public, _site, build...). Served locally and audited before you deploy.
                       Works for any tool that produces static HTML. Cannot be combined with --url.
  --out <dir>          Output directory (default: ./seo-geo-report)
  --pages <n>          Max pages to sample from the sitemap, including the start page (default: 6)
  --lang <es|en>       Report language (default: es)
  --allow-local        Allow localhost / private addresses (blocked by default as an SSRF guard)
  --compare <file|auto>  Compare with a previous audit.json and add a "Progress" section. "auto" uses the one already in --out
  --fail-on <tier>     Exit with code 1 if a check of this tier or worse fails: blocker | important
  --quiet              No progress output
  -h, --help
`;

function parseArgs(argv) {
  const o = { out: './seo-geo-report', pages: 6, lang: 'es', allowLocal: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': o.url = next(); break;
      case '--src': o.src = next(); break;
      case '--build': o.build = next(); break;
      case '--out': o.out = next(); break;
      case '--pages': o.pages = Math.max(1, Math.min(25, Number(next()) || 6)); break;
      case '--lang': o.lang = next(); break;
      case '--allow-local': o.allowLocal = true; break;
      case '--compare': o.compare = next(); break;
      case '--fail-on': o.failOn = next(); break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.build && o.url) throw new Error('--build and --url cannot be used together (a build is audited locally; a URL is audited as published)');
  if (o.help || (!o.url && !o.src && !o.build)) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2); }
  if (!['es', 'en'].includes(o.lang)) throw new Error('--lang must be es or en');
  if (o.failOn && !['blocker', 'important'].includes(o.failOn)) throw new Error('--fail-on must be blocker or important');
  if (o.url && !/^https?:\/\//i.test(o.url)) o.url = `https://${o.url}`;

  // Anything printed may include text from the audited site: strip control and invisible characters first.
  const log = o.quiet ? () => {} : (m) => process.stderr.write(`• ${sanitize(m, 400)}\n`);
  // Safety net: never end silently. A stuck audit fails loudly after 5 minutes.
  const watchdog = setTimeout(() => { process.stderr.write('Error: audit timed out after 5 minutes\n'); process.exit(2); }, 300_000);
  const c = new Collector();
  const meta = { date: new Date().toISOString().slice(0, 10), tool: 'rg-seo-geo-skill 0.1.0' };

  if (o.src) {
    const r = runNextAudit({ src: o.src }, c, log);
    Object.assign(meta, r.meta);
    if (r.skipped) log(r.meta.note);
  }
  if (o.build) {
    const dir = path.resolve(o.build);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--build must be a directory: ${o.build}`);
    const srv = await serveStatic(dir);
    c.redact(srv.origin);
    try {
      log(`Serving ${path.basename(dir)} locally${srv.productionOrigin ? ` (production URLs ${srv.productionOrigin} are mapped to the local copy)` : ''}`);
      const r = await runUrlAudit({ url: `${srv.origin}/`, allowLocal: true, maxPages: o.pages, localBuild: true }, c, log);
      Object.assign(meta, r.meta);
      if (r.aborted) log(`Could not audit the build: ${r.meta.error}`);
      // Reports are shared: show the build folder name and paths only, never absolute local paths or the temporary port.
      meta.build = true;
      meta.buildDir = path.basename(dir);
      meta.productionOrigin = srv.productionOrigin || undefined;
      meta.pages = (r.meta.pages || []).map((u) => new URL(u).pathname);
      for (const k of ['url', 'finalUrl', 'origin']) delete meta[k];
    } finally { await srv.close(); }
  }
  if (o.url) {
    const r = await runUrlAudit({ url: o.url, allowLocal: o.allowLocal, maxPages: o.pages }, c, log);
    Object.assign(meta, r.meta);
    if (r.aborted) log(`Could not audit ${o.url}: ${r.meta.error}`);
  }

  clearTimeout(watchdog);
  // The previous audit is untrusted data: bounded size, parsed as JSON only, validated in compareAudits().
  let previous;
  if (o.compare) {
    const file = o.compare === 'auto' ? path.join(o.out, 'audit.json') : o.compare;
    const lst = lstatOrNull(file);
    if (lst) {
      if (lst.isSymbolicLink()) throw new Error(`--compare: refusing to read through a symlink: ${path.basename(file)}`);
      try {
        if (lst.size > 5_000_000) throw new Error('file is larger than 5 MB');
        previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch { throw new Error(`--compare: ${path.basename(file)} is not a valid audit.json`); }   // never echo parser errors: they quote file contents
    } else if (o.compare !== 'auto') throw new Error(`--compare: file not found: ${file}`);
    else log('--compare auto: no previous audit.json in the output folder yet; this run becomes the baseline');
  }
  cleanMeta(meta);
  const report = buildReport(c.results(), meta, o.lang, previous);
  // Never write through a symlink (a cloned repo can ship one named report.md pointing at a file you care about).
  const targets = ['report.html', 'report.md', 'audit.json'].map((f) => path.join(o.out, f));
  const outStat = lstatOrNull(o.out);
  if (outStat && outStat.isSymbolicLink()) throw new Error(`refusing to write into an output folder that is a symlink: ${o.out}`);
  for (const t of targets) { const st = lstatOrNull(t); if (st && (st.isSymbolicLink() || !st.isFile())) throw new Error(`refusing to overwrite ${path.basename(t)}: it is a symlink or not a regular file`); }
  fs.mkdirSync(o.out, { recursive: true });
  safeWrite(targets[0], toHtml(report));
  safeWrite(targets[1], toMarkdown(report));
  safeWrite(targets[2], JSON.stringify({ notice: report.t.untrusted, meta, verdict: report.verdict, totals: report.totals, findings: report.findings }, null, 2));

  const tt = report.totals;
  process.stdout.write(`${report.t.verdict[report.verdict]}\n` +
    `  blockers: ${tt.blockers}  failed: ${tt.fail}  to improve: ${tt.warn}  passed: ${tt.pass}  not evaluated: ${tt.skip}\n` +
    `  report: ${path.resolve(o.out, 'report.html')}\n`);

  if (o.failOn === 'blocker' && tt.blockers > 0) process.exit(1);
  if (o.failOn === 'important' && (tt.blockers > 0 || tt.importantFails > 0)) process.exit(1);
}

function lstatOrNull(f) { try { return fs.lstatSync(f); } catch { return null; } }

/** Open without following symlinks (O_NOFOLLOW) so a race cannot redirect the write either. */
function safeWrite(file, data) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o644);
  try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
}

/** Metadata ends up in shared reports: bound it, strip hostile characters, and drop local paths. */
function cleanMeta(meta) {
  delete meta.srcPath;
  for (const k of ['src', 'buildDir', 'framework', 'stack', 'productionOrigin', 'finalUrl', 'url', 'origin', 'error', 'tool', 'date']) {
    if (typeof meta[k] === 'string') meta[k] = sanitize(meta[k], 200);
  }
  if (Array.isArray(meta.pages)) meta.pages = meta.pages.slice(0, 50).map((u) => sanitize(u, 300));
  if (Array.isArray(meta.notes)) meta.notes = meta.notes.filter((n) => typeof n === 'string').slice(0, 10).map((n) => sanitize(n, 40));
}

main().catch((e) => { process.stderr.write(`Error: ${sanitize(e.message, 400)}\n`); process.exit(2); });
