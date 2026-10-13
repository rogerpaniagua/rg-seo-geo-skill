// Generates skills/rg-seo-geo-skill/references/standard.{es,en}.md from the catalog,
// so the human-readable standard can never drift from what the audit enforces.
import fs from 'node:fs';
import { CHECKS, CATEGORIES } from '../skills/rg-seo-geo-skill/scripts/lib/catalog.mjs';

const T = {
  en: {
    h1: 'The SEO & GEO standard', intro: 'Every check the audit runs, in one place. This file is generated from `scripts/lib/catalog.mjs`: edit the catalog, then run `npm run docs`.',
    tiers: '## Tiers\n\n- **Blocker**: breaks indexing or sharing. Fix before launch. Only measurable or officially documented rules can be blockers.\n- **Important**: hurts visibility or quality. Fix soon.\n- **Advice**: polish and best practice.\n',
    basis: '## Basis (how much to trust a rule)\n\n- **Official**: stated in Google Search Central or Next.js documentation (source linked).\n- **Measured**: a verifiable fact about your page or code (a status code, a tag).\n- **Heuristic**: community practice with no official or proven effect. Never a blocker, never presented as a requirement.\n',
    mode: { url: 'Published site', source: 'Source code (Next.js, Astro, Nuxt, SvelteKit, SPAs, template stacks, WordPress)' }, cols: ['Tier', 'Check', 'Why', 'How to fix', 'Basis', 'Source'],
    t: { blocker: 'Blocker', important: 'Important', advice: 'Advice' }, b: { official: 'Official', measured: 'Measured', heuristic: 'Heuristic' },
  },
  es: {
    h1: 'El estándar SEO y GEO', intro: 'Todos los checks que ejecuta la auditoría, en un solo lugar. Este archivo se genera desde `scripts/lib/catalog.mjs`: edita el catálogo y corre `npm run docs`.',
    tiers: '## Niveles\n\n- **Bloqueante**: rompe la indexación o el compartir. Corregir antes del lanzamiento. Solo reglas medibles o documentadas oficialmente pueden ser bloqueantes.\n- **Importante**: reduce visibilidad o calidad. Corregir pronto.\n- **Consejo**: pulido y buenas prácticas.\n',
    basis: '## Base (cuánto confiar en una regla)\n\n- **Oficial**: está en la documentación de Google Search Central o Next.js (fuente enlazada).\n- **Medido**: un hecho verificable de tu página o código (un código de estado, una etiqueta).\n- **Heurística**: práctica de la comunidad sin efecto oficial ni probado. Nunca es bloqueante ni se presenta como requisito.\n',
    mode: { url: 'Sitio publicado', source: 'Código fuente (Next.js, Astro, Nuxt, SvelteKit, SPAs, plantillas, WordPress)' }, cols: ['Nivel', 'Check', 'Por qué', 'Cómo corregir', 'Base', 'Fuente'],
    t: { blocker: 'Bloqueante', important: 'Importante', advice: 'Consejo' }, b: { official: 'Oficial', measured: 'Medido', heuristic: 'Heurística' },
  },
};
for (const lang of ['es', 'en']) {
  const t = T[lang];
  const out = [`# ${t.h1}`, '', t.intro, '', t.tiers, t.basis];
  for (const mode of ['url', 'source']) {
    out.push(`## ${t.mode[mode]}`, '');
    for (const [key, name] of Object.entries(CATEGORIES)) {
      const items = CHECKS.filter((c) => c.category === key && c.mode === mode);
      if (!items.length) continue;
      out.push(`### ${name[lang]}`, '', `| ${t.cols.join(' | ')} |`, `|${t.cols.map(() => '---').join('|')}|`);
      for (const c of items) out.push(`| ${t.t[c.tier]} | ${c.title[lang]} | ${c.why[lang].replace(/\|/g, '\\|')} | ${c.fix[lang].replace(/\|/g, '\\|')} | ${t.b[c.basis]} | [link](${c.source}) |`);
      out.push('');
    }
  }
  fs.writeFileSync(new URL(`../skills/rg-seo-geo-skill/references/standard.${lang}.md`, import.meta.url), out.join('\n'));
}
console.log(`Generated standard for ${CHECKS.length} checks.`);
