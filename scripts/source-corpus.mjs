// Runs source review over a folder of cloned real projects and prints a calibration summary.
//   node scripts/source-corpus.mjs <folder-with-projects> [--sub name=relative/path ...]
import fs from 'node:fs';
import path from 'node:path';
import { Collector } from '../skills/rg-seo-geo-skill/scripts/lib/collector.mjs';
import { runSourceAudit } from '../skills/rg-seo-geo-skill/scripts/lib/source/index.mjs';

const base = process.argv[2];
const subs = Object.fromEntries(process.argv.slice(3).filter((a) => a.includes('=')).map((a) => a.split('=')));
const rows = [];
for (const name of fs.readdirSync(base).filter((n) => fs.statSync(path.join(base, n)).isDirectory()).sort()) {
  const dir = path.join(base, name, subs[name] || '');
  if (!fs.existsSync(dir)) continue;
  const c = new Collector();
  const t = Date.now();
  let out, err;
  try { out = runSourceAudit({ src: dir }, c); } catch (e) { err = e.message; }
  const r = c.results();
  const line = r.filter((x) => ['fail', 'warn'].includes(x.status)).map((x) => `${x.status === 'fail' ? '✕' : '!'}${x.id.replace(/^(src|wp|next)\./, '')}`).join(' ');
  console.log(`\n== ${name}${subs[name] ? '/' + subs[name] : ''}: ${err ? 'ERROR ' + err : out.skipped ? 'SKIPPED — ' + (out.meta.note || '').slice(0, 130) : out.meta.framework} (${Date.now() - t}ms)`);
  if (!err && !out.skipped) { console.log('   ' + line); rows.push({ name, framework: out.meta.framework, results: r }); }
}
fs.writeFileSync(path.join(base, '_results.json'), JSON.stringify(rows.map((x) => ({ name: x.name, framework: x.framework, results: x.results })), null, 1));
