#!/usr/bin/env node
// SEO & GEO audit CLI. Zero dependencies, Node 18+.
//
//   node audit.mjs --url https://example.com [--src ./project] [--out ./seo-geo-report]
//                  [--pages 6] [--lang es|en] [--allow-local] [--fail-on blocker|important]
//
// Writes report.html, report.md and audit.json into --out. Exit code 1 when --fail-on is hit.

import fs from 'node:fs';
import path from 'node:path';
import { Collector } from './lib/collector.mjs';
import { runUrlAudit } from './lib/url-checks.mjs';
import { runNextAudit } from './lib/next-checks.mjs';
import { buildReport, toHtml, toMarkdown } from './lib/report.mjs';

const HELP = `rg-seo-geo-skill

Usage:
  node audit.mjs --url <https://site> [options]
  node audit.mjs --src <project-dir> [options]
  node audit.mjs --url <https://site> --src <project-dir>      (both)

Options:
  --url <url>          Published site (or local dev server with --allow-local). Works for any stack.
  --src <dir>          Source code to inspect (Next.js App Router supported).
  --out <dir>          Output directory (default: ./seo-geo-report)
  --pages <n>          Max pages to sample from the sitemap, including the start page (default: 6)
  --lang <es|en>       Report language (default: es)
  --allow-local        Allow localhost / private addresses (blocked by default as an SSRF guard)
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
      case '--out': o.out = next(); break;
      case '--pages': o.pages = Math.max(1, Math.min(25, Number(next()) || 6)); break;
      case '--lang': o.lang = next(); break;
      case '--allow-local': o.allowLocal = true; break;
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
  if (o.help || (!o.url && !o.src)) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2); }
  if (!['es', 'en'].includes(o.lang)) throw new Error('--lang must be es or en');
  if (o.failOn && !['blocker', 'important'].includes(o.failOn)) throw new Error('--fail-on must be blocker or important');
  if (o.url && !/^https?:\/\//i.test(o.url)) o.url = `https://${o.url}`;

  const log = o.quiet ? () => {} : (m) => process.stderr.write(`• ${m}\n`);
  // Safety net: never end silently. A stuck audit fails loudly after 5 minutes.
  const watchdog = setTimeout(() => { process.stderr.write('Error: audit timed out after 5 minutes\n'); process.exit(2); }, 300_000);
  const c = new Collector();
  const meta = { date: new Date().toISOString().slice(0, 10), tool: 'rg-seo-geo-skill 0.1.0' };

  if (o.src) {
    const r = runNextAudit({ src: o.src }, c, log);
    Object.assign(meta, r.meta);
    if (r.skipped) log(r.meta.note);
  }
  if (o.url) {
    const r = await runUrlAudit({ url: o.url, allowLocal: o.allowLocal, maxPages: o.pages }, c, log);
    Object.assign(meta, r.meta);
    if (r.aborted) log(`Could not audit ${o.url}: ${r.meta.error}`);
  }

  clearTimeout(watchdog);
  const report = buildReport(c.results(), meta, o.lang);
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, 'report.html'), toHtml(report));
  fs.writeFileSync(path.join(o.out, 'report.md'), toMarkdown(report));
  fs.writeFileSync(path.join(o.out, 'audit.json'), JSON.stringify({ meta, verdict: report.verdict, totals: report.totals, findings: report.findings }, null, 2));

  const tt = report.totals;
  process.stdout.write(`${report.t.verdict[report.verdict]}\n` +
    `  blockers: ${tt.blockers}  failed: ${tt.fail}  to improve: ${tt.warn}  passed: ${tt.pass}  not evaluated: ${tt.skip}\n` +
    `  report: ${path.resolve(o.out, 'report.html')}\n`);

  if (o.failOn === 'blocker' && tt.blockers > 0) process.exit(1);
  if (o.failOn === 'important' && (tt.blockers > 0 || tt.importantFails > 0)) process.exit(1);
}

main().catch((e) => { process.stderr.write(`Error: ${e.message}\n`); process.exit(2); });
