# rg-seo-geo-skill

A [Claude Code](https://claude.com/claude-code) skill and zero-dependency CLI that audits **SEO** and **AI-search (GEO)** quality for any website, and writes a shareable quality report. Deep checks for **Next.js (App Router)** projects.

[Leer en español](README.es.md)

## Why this exists

Most SEO/GEO tools either score pages with an LLM (not reproducible) or repeat unproven advice. This one is built on three rules:

1. **Deterministic.** It fetches your pages like a crawler and reads your source files. Same input, same output.
2. **Transparent standard.** All 61 checks live in [`catalog.mjs`](skills/seo-geo-audit/scripts/lib/catalog.mjs), each with a tier (blocker / important / advice), a basis (**official** / **measured** / **heuristic**) and a source link. [Read the standard](skills/seo-geo-audit/references/standard.en.md).
3. **Honest about GEO.** Heuristics are labelled and can never block a launch. llms.txt is informational: Google says it has no effect on Search.

There is deliberately **no composite 0–100 score**. The verdict comes from blockers and important failures.

## Quick start

Requires Node 18+. No install, no dependencies.

```bash
# any published site
node skills/seo-geo-audit/scripts/audit.mjs --url https://example.com --lang en

# no sitemap? it discovers pages through internal links
# a Next.js project + its live URL
node skills/seo-geo-audit/scripts/audit.mjs --url https://example.com --src ../my-site --out ./report

# CI gate: exit code 1 on blockers
node skills/seo-geo-audit/scripts/audit.mjs --url https://staging.example.com --fail-on blocker --quiet
```

Output: `report.html` (team report), `report.md`, `audit.json`.

## Use it as a Claude Code skill

```bash
cp -R skills/seo-geo-audit ~/.claude/skills/
```

Then ask Claude: *"audit the SEO and GEO of https://… and the project in ~/code/my-site"*. The skill runs the script, explains the evidence in your language, and offers fixes (see [`references/nextjs-fixes.md`](skills/seo-geo-audit/references/nextjs-fixes.md)).

## What it checks

| Area | Examples |
|---|---|
| Crawling & indexing | robots.txt, sitemap validity and lastmod, canonical, noindex, redirects, soft 404, HTTPS, www/non-www |
| Metadata | title, description, H1, lang, viewport, uniqueness across pages |
| Social | Open Graph, og:image reachability and size, Twitter card, icons |
| Structured data | JSON-LD validity, entity, required properties |
| Content | server-rendered text, alt text, crawlable links, hreflang |
| AI search (GEO) | AI crawler access in robots.txt and at the server, snippet controls, entity links, authorship, extractable structure |
| Next.js source | `metadataBase`, `generateMetadata`, canonical inheritance, `sitemap.ts` coverage, `opengraph-image`, Server Components |

## What it does not do

It cannot judge content quality, search intent, E-E-A-T, backlinks or real-user data, and it does not predict AI citations. It does not measure performance either: the report links to PageSpeed Insights, Search Console, the Rich Results Test and the sharing debuggers, pre-filled with your URL. It reads the HTML the server sends and does not run JavaScript; client-rendered pages are flagged in the report. Source mode reads files with regular expressions; unusual project layouts may be skipped (reported as *not evaluated*).

## Security

The tool fetches URLs you give it, so it blocks private, loopback and link-local addresses by default (checked at connect time to resist DNS rebinding) and re-validates every redirect hop. `--allow-local` is required to audit a local dev server. It never executes project code. It makes no third-party calls: only your site is contacted.

## Development

```bash
npm test          # unit + integration tests (local fixture servers, Next.js fixtures)
npm run docs      # regenerate references/standard.*.md from the catalog
```

To add a check: add it to `catalog.mjs` (bilingual text, tier, basis, source), emit it from `url-checks.mjs` or `next-checks.mjs`, add a test, run `npm run docs`. Heuristic checks must not be blockers (enforced by a test).

## License

MIT
