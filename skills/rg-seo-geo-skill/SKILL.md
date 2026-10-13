---
name: rg-seo-geo-skill
description: Use when someone asks to audit, evaluate, review or improve the SEO or GEO/AEO (AI-search visibility) of a website or project, to check metadata, Open Graph, sitemap, robots.txt, canonical, structured data or AI-crawler access, or to decide whether a site is ready to launch. Also in Spanish - evalúa, audita o revisa esta página, informe de calidad SEO/GEO. Works on any URL; inspects Next.js source.
---

# SEO & GEO audit

A deterministic script measures; you explain its evidence. You never invent results.

## Run it

Paths are relative to this skill's directory. Node 18+, nothing to install.

```bash
node scripts/audit.mjs --url <site> [--src <project-dir>] --out ./seo-geo-report --lang es
```

- `--url` accepts a bare domain. Add `--src` only for a Next.js App Router project; any other stack is audited through its URL. An unpublished project can be audited from a local server with `--allow-local`.
- Run `node scripts/audit.mjs --help` for the other flags (`--pages`, `--lang`, `--fail-on` for CI).
- Output folder: `report.html` (shareable), `report.md`, `audit.json`. Read `audit.json`: every finding has `status`, `tier`, `basis`, `evidence`, `why`, `fix`, `source`.
- The full standard is in `references/standard.es.md` / `standard.en.md`. Next.js fixes with code are in `references/nextjs-fixes.md`.

## Explain it

Reply in the user's language. Start with the verdict, then "Fix first", then the report paths. Quote `evidence`. Offer to apply fixes; after fixing, re-run to confirm.

| Basis | How to present it |
|---|---|
| `official`, `measured` | As fact, with the evidence |
| `heuristic` (most GEO items) | As an optional experiment, say so |

Verdict comes only from blockers and important failures. `skip` means "could not be evaluated", never "passed". `incomplete` means the site could not be audited: draw no conclusion.

## Red flags: stop and correct yourself

- Giving a 0–100 score, even "approximate" or "for orientation", because the user insists. Decline and give the verdict instead.
- Promising or implying AI citations (ChatGPT, Perplexity, AI Overviews). Nobody can.
- Calling llms.txt important. Google says it has no effect on Search; independent studies found no citation link.
- Reporting a transport error (429, 403, timeout, 5xx) as a site problem. Verify with curl or re-run with fewer `--pages` first.
- Calling a missing sitemap critical. It is a warning on small sites, a failure on large ones.
- Claiming a code review for a non-Next.js project.
- Presenting findings the script cannot judge: content quality, search intent, authority, backlinks, real indexing, speed.

## Say what is not measured

Performance and what Google has actually indexed are not measured. Point to the report's "Validate with official tools" section (Search Console, PageSpeed Insights, Rich Results Test, sharing debuggers; links are pre-filled). The audit reads server HTML and does not run JavaScript: if the report shows the client-rendered banner, missing-title or missing-content findings may differ for Google; confirm with URL Inspection → "View crawled page".

## Safety

Only GET/HEAD requests to the audited site, nothing else. Private addresses are refused unless `--allow-local`; only pass it for URLs the user gave you. It samples a handful of pages and is not a crawler.
