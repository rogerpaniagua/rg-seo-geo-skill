// Runs the audit over a list of real sites (test/corpus.txt) and prints a calibration summary.
// Purpose: find false positives and over-flagging before trusting a check. It is a dev tool,
// not part of the skill. Be a good citizen: sequential, a pause between sites, few pages per site.
//
//   node scripts/corpus.mjs [--list test/corpus.txt] [--out reports/corpus] [--pages 4] [--delay 2000]

import fs from 'node:fs';
import path from 'node:path';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';
import { runUrlAudit } from '../skills/rg-seo-geo-skill/scripts/lib/url-checks.mjs';
import { buildReport } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const list = arg('--list', 'test/corpus.txt');
const out = arg('--out', 'reports/corpus');
const pages = Number(arg('--pages', 4));
const delay = Number(arg('--delay', 2000));
fs.mkdirSync(out, { recursive: true });

const urls = fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const rows = [];
for (const url of urls) {
  const t0 = Date.now();
  const c = new Collector();
  let result, error;
  try {
    result = await Promise.race([
      runUrlAudit({ url, maxPages: pages }, c),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 150s')), 150_000)),
    ]);
  } catch (e) { error = e.message; }
  const meta = { date: new Date().toISOString().slice(0, 10), ...(result ? result.meta : { url, error }) };
  const rep = buildReport(c.results(), meta, 'en');
  if (error) rep.verdict = 'ERROR';
  const host = new URL(url).hostname;
  fs.writeFileSync(path.join(out, `${host}.json`), JSON.stringify({ meta, verdict: rep.verdict, totals: rep.totals, findings: rep.findings }, null, 2));
  rows.push({ host, verdict: rep.verdict, stack: meta.stack || '-', pages: (meta.pages || []).length, ...rep.totals, secs: Math.round((Date.now() - t0) / 1000), error: error || (result && result.aborted ? meta.error : '') });
  console.log(`${host.padEnd(26)} ${rep.verdict.padEnd(10)} stack=${String(meta.stack || '-').padEnd(10)} pages=${(meta.pages || []).length} blockers=${rep.totals.blockers} fail=${rep.totals.fail} warn=${rep.totals.warn} skip=${rep.totals.skip} ${Math.round((Date.now() - t0) / 1000)}s ${error || ''}`);
  await new Promise((r) => setTimeout(r, delay));
}

// Which checks fail most often? A check failing on most healthy, well-known sites is suspect.
const freq = new Map();
for (const f of fs.readdirSync(out).filter((n) => n.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  for (const x of j.findings) {
    if (x.status !== 'fail' && x.status !== 'warn') continue;
    const k = `${x.id} [${x.tier}]`;
    if (!freq.has(k)) freq.set(k, { fail: 0, warn: 0, sites: [] });
    const e = freq.get(k); e[x.status]++; e.sites.push(f.replace('.json', ''));
  }
}
console.log('\nMost frequent findings (candidates for over-flagging):');
[...freq.entries()].sort((a, b) => (b[1].fail + b[1].warn) - (a[1].fail + a[1].warn)).slice(0, 25)
  .forEach(([k, v]) => console.log(`  ${String(v.fail).padStart(2)} fail ${String(v.warn).padStart(2)} warn  ${k}`));
fs.writeFileSync(path.join(out, '_summary.json'), JSON.stringify(rows, null, 2));
