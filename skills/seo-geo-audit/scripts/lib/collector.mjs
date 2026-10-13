import { CHECKS, CHECK_BY_ID } from './catalog.mjs';

// Result statuses. A check run over several pages keeps its worst status.
//   fail  violates the standard      warn  partially met / borderline
//   pass  met                        info  informational only        skip  could not be evaluated
const RANK = { fail: 4, warn: 3, info: 2, pass: 1, skip: 0 };

export class Collector {
  constructor() { this.items = new Map(); }

  add(id, status, evidence = '', scope = '') {
    if (!CHECK_BY_ID.has(id)) throw new Error(`Unknown check id: ${id}`);
    if (!(status in RANK)) throw new Error(`Unknown status: ${status}`);
    if (!this.items.has(id)) this.items.set(id, []);
    this.items.get(id).push({ status, evidence, scope });
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
