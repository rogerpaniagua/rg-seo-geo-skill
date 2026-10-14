import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateEvidence } from '../skills/rg-seo-geo-skill/scripts/lib/evidence-i18n.mjs';
import { buildReport, toMarkdown, toHtml } from '../skills/rg-seo-geo-skill/scripts/lib/report.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../skills/rg-seo-geo-skill/scripts');
const SOURCES = ['lib/url-checks.mjs', 'lib/next-checks.mjs', ...['index', 'common', 'astro', 'nuxt', 'sveltekit', 'spa', 'templates'].map((f) => `lib/source/${f}.mjs`)];
const ENGLISH = /\b(the|and|not|is|are|of|for|with|found|missing|add|your|from|that|this|has|have|can|will|does|its|use|every|but|when|you)\b/;

// Every literal passed to c.add(...) in the checks is a phrase a Spanish report can show. This reads them from the
// source, so a phrase added later without a Spanish rule fails here instead of leaking English into a report.
test('every evidence phrase the checks emit has a Spanish translation', () => {
  const gaps = [];
  for (const f of SOURCES) {
    fs.readFileSync(path.join(SCRIPTS, f), 'utf8').split('\n').forEach((line, i) => {
      if (!/c\.add\(|evidence:|\.push\(`|const (note|where|noindexEvidence) =|sm = |wpHints = |\['(warn|fail|pass)', '/.test(line)) return;
      for (const m of line.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)'/g)) {
        let s = m[1] ?? m[2];
        if (!/[a-z]{3}/.test(s) || /^(pass|fail|warn|skip|info|[a-z]+\.[a-z-]+)$/.test(s)) continue;
        s = s.replace(/\$\{[^}]*\}/g, '7').replace(/\\'/g, "'").replace(/\\`/g, '`');
        if (ENGLISH.test(translateEvidence(s, 'es').replace(/"[^"]*"/g, '').replace(/npx astro add sitemap/, ''))) gaps.push(`${f}:${i + 1} ${s.slice(0, 90)}`);
      }
    });
  }
  // Known artefacts of reading source lines: a path, and pieces of strings that are joined at run time.
  const real = gaps.filter((g) => !/app\/not-found|sets robots|in this project|actually served/.test(g));
  assert.deepEqual(real, []);
});

test('English reports and audit data keep the original English', () => {
  assert.equal(translateEvidence('no redirects', 'en'), 'no redirects');
  assert.equal(translateEvidence('no redirects', 'es'), 'sin redirecciones');
});

test('text quoted from the audited site is never translated', () => {
  const t = translateEvidence('relative canonical "/the-missing-page" ', 'es');
  assert.match(t, /"\/the-missing-page"/);
  assert.match(t, /canonical relativa/);
  assert.equal(translateEvidence('User-agent: * is disallowed from "/"', 'es'), 'User-agent: * tiene prohibido "/"');
});

test('scoped, aggregated and not-evaluated lines translate piece by piece', () => {
  assert.equal(translateEvidence('/about: missing', 'es'), '/about: falta');
  assert.equal(translateEvidence('… +4 more', 'es'), '… +4 más');
  assert.equal(translateEvidence('not evaluated (/pricing): HTTP 403: automated access refused (bot protection or login); not evaluated', 'es'),
    'no evaluado (/pricing): HTTP 403: acceso automatizado rechazado (protección anti-bots o login); no evaluado');
});

test('a Spanish report shows Spanish evidence while the findings keep the English source', () => {
  const results = [{ id: 'meta.description', status: 'fail', evidence: ['missing'], pagesChecked: 1 }];
  const meta = { target: 'https://example.com', date: '2026-10-14', mode: 'url' };
  const es = buildReport(results, meta, 'es');
  assert.deepEqual(es.findings[0].evidence, ['missing']);
  assert.deepEqual(es.findings[0].evidenceShown, ['falta']);
  assert.match(toMarkdown(es), /falta/);
  assert.match(toHtml(es), /<li>falta<\/li>/);
  const en = buildReport(results, meta, 'en');
  assert.deepEqual(en.findings[0].evidenceShown, ['missing']);
});
