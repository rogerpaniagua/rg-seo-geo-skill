import { CHECKS, CHECK_BY_ID } from './catalog.mjs';

// Evidence quotes text from the audited site, and is read by humans and by AI agents. Strip control,
// invisible and bidirectional-override characters, collapse whitespace (so no line can start a
// Markdown heading) and bound the length, so a hostile page cannot smuggle payloads into a report.
export function sanitize(value, max = 300) {
  const s = String(value ?? '')
    .replace(/[\p{Zs}\s]+/gu, ' ')                                  // collapse every kind of whitespace, including newlines
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, '')              // controls, invisible format chars (incl. Unicode "tag" characters U+E0000-E007F), private use
    .replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, '')            // variation selectors
    .trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Result statuses. A check run over several pages keeps its worst status.
//   fail  violates the standard      warn  partially met / borderline
//   pass  met                        info  informational only        skip  could not be evaluated
const RANK = { fail: 4, warn: 3, info: 2, pass: 1, skip: 0 };

export class Collector {
  constructor() { this.items = new Map(); this.redactions = []; }

  /** Strings to remove from every evidence line (e.g. the local origin of a --build audit, so reports show paths only). */
  redact(...strings) { for (const x of strings) if (x) this.redactions.push(x); }

  add(id, status, evidence = '', scope = '') {
    if (!CHECK_BY_ID.has(id)) throw new Error(`Unknown check id: ${id}`);
    if (!(status in RANK)) throw new Error(`Unknown status: ${status}`);
    if (!this.items.has(id)) this.items.set(id, []);
    const clean = (v) => this.redactions.reduce((acc, r) => String(acc).split(r).join(''), v);
    this.items.get(id).push({ status, evidence: sanitize(clean(evidence)), scope: sanitize(clean(scope), 120) });
  }

  results() {
    const out = [];
    for (const c of CHECKS) {
      const entries = this.items.get(c.id);
      if (!entries) continue;
      const status = entries.reduce((w, e) => (RANK[e.status] > RANK[w] ? e.status : w), 'skip');
      // Evidence: show the entries that explain the worst status; for pass show a short summary.
      const worst = entries.filter((e) => e.status === status);
      const evidence = worst
        .slice(0, 6)
        .map((e) => (e.scope ? `${e.scope}: ${e.evidence}` : e.evidence))
        .filter(Boolean);
      if (worst.length > 6) evidence.push(`… +${worst.length - 6} more`);
      // Pages that could not be evaluated must stay visible even when other pages passed.
      if (status !== 'skip') {
        for (const e of entries.filter((x) => x.status === 'skip' && x.evidence).slice(0, 3)) {
          evidence.push(`not evaluated${e.scope ? ` (${e.scope})` : ''}: ${e.evidence}`);
        }
      }
      out.push({ id: c.id, status, evidence, pagesChecked: entries.length });
    }
    return out;
  }
}
