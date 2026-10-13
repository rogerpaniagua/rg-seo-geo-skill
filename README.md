# rg-seo-geo-skill

A [Claude Code](https://claude.com/claude-code) skill and zero-dependency CLI that audits **SEO** and **AI-search (GEO)** quality for any website, and writes a shareable quality report. Deep checks for **Next.js (App Router)** projects.

[Leer en español](README.es.md)

## Why this exists

Most SEO/GEO tools either score pages with an LLM (not reproducible) or repeat unproven advice. This one is built on three rules:

1. **Deterministic.** It fetches your pages like a crawler and reads your source files. Same input, same output.
2. **Transparent standard.** All 82 checks live in [`catalog.mjs`](skills/rg-seo-geo-skill/scripts/lib/catalog.mjs), each with a tier (blocker / important / advice), a basis (**official** / **measured** / **heuristic**) and a source link. [Read the standard](skills/rg-seo-geo-skill/references/standard.en.md).
3. **Honest about GEO.** Heuristics are labelled and can never block a launch. llms.txt is informational: Google says it has no effect on Search.

There is deliberately **no composite 0–100 score**. The verdict comes from blockers and important failures.

## Quick start

Requires Node 18+. No install, no dependencies.

```bash
# any published site
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://example.com --lang en

# a project folder (Next.js, Astro, Nuxt, SvelteKit, Vite SPA, Jekyll, Hugo, Laravel, Django, WordPress...) + its live URL
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://example.com --src ../my-site --out ./report

# before deploying, any stack: audit the compiled output (dist, out, public, _site, build...)
node skills/rg-seo-geo-skill/scripts/audit.mjs --build ./dist

# show progress against the previous audit stored in the output folder
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://example.com --out ./report --compare auto

# CI gate: exit code 1 on blockers
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://staging.example.com --fail-on blocker --quiet
```

Output: `report.html` (team report), `report.md`, `audit.json`.

## Use it as a Claude Code skill

```bash
cp -R skills/rg-seo-geo-skill ~/.claude/skills/
```

Then ask Claude: *"audit the SEO and GEO of https://… and the project in ~/code/my-site"*. The skill runs the script, explains the evidence in your language, and offers fixes (see [`references/nextjs-fixes.md`](skills/rg-seo-geo-skill/references/nextjs-fixes.md)).

## What it checks

| Area | Examples |
|---|---|
| Crawling & indexing | robots.txt, sitemap validity and lastmod, canonical, noindex, redirects, soft 404, HTTPS, www/non-www |
| Metadata | title, description, H1, lang, viewport, uniqueness across pages |
| Social | Open Graph, og:image reachability and size, Twitter card, icons |
| Structured data | JSON-LD validity, entity, required properties |
| Content | server-rendered text, alt text, crawlable links, hreflang |
| Site health | broken and redirected internal links, mixed content, image dimensions |
| AI search (GEO) | AI crawler access in robots.txt and at the server, snippet controls, entity links, authorship, extractable structure |
| Source code | **Next.js** (deep), **Astro**, **Nuxt**, **SvelteKit**, **Vite/React/Vue/Angular single-page apps** (deep), and a heuristic pass for **Jekyll, Hugo, Eleventy, Laravel, Django, Rails, WordPress themes**, plain PHP/HTML. See [source-fixes](skills/rg-seo-geo-skill/references/source-fixes.md) |

## What it does not do

It cannot judge content quality, search intent, E-E-A-T, backlinks or real-user data, and it does not predict AI citations. It does not measure performance either: the report links to PageSpeed Insights, Search Console, the Rich Results Test and the sharing debuggers, pre-filled with your URL. It reads the HTML the server sends and does not run JavaScript; client-rendered pages are flagged in the report. Source mode reads files with regular expressions; unusual project layouts may be skipped (reported as *not evaluated*).

## Calibrated on real sites

The checks are tuned against a corpus of 27 real sites ([`test/corpus.txt`](test/corpus.txt)): WordPress, Shopify, Wix, Webflow, Next.js, Astro, Nuxt, SvelteKit, Laravel, Django, news sites behind bot protection, and more. Running it found real bugs (a crash on a 118k-URL sitemap, 16 KB response headers, bot-protection 403s read as site errors) and checks that were stricter than Google itself (missing canonical, H1 or JSON-LD are not requirements). Each became a regression test. Run it yourself with `npm run corpus`.

## Security

This tool visits URLs it does not control and parses documents written by strangers, so it was attacked before it was published: an independent reviewer tried to exploit it, and every confirmed finding became a regression test ([`test/security.test.mjs`](test/security.test.mjs), [`test/security2.test.mjs`](test/security2.test.mjs)).

- **SSRF:** private, loopback, link-local and metadata addresses are refused, including IPv6 forms that hide an IPv4 address (mapped, NAT64, 6to4, Teredo). The check runs at connect time (no DNS rebinding) and again on every redirect hop. `--allow-local` and `--build` reach **one origin only**, never anything the audited content points to.
- **Hostile input:** HTML, XML, robots.txt and JSON-LD are parsed in a single linear pass. Inputs that hung the first, regex-based parser for minutes (e.g. 700k unclosed `<a ` tags) now take milliseconds. Responses are size-capped (decompression bombs included) and time-limited.
- **`--build` server:** loopback only, GET/HEAD only, cannot leave the folder (traversal, encoded traversal, symlinks, dotfiles), rejects foreign `Host` headers (DNS rebinding).
- **Reports:** text quoted from the audited site is stripped of control and invisible Unicode characters, bounded, and escaped in HTML and Markdown. Reports and `audit.json` carry an "untrusted content" notice, because an AI agent may read them.
- **Files:** `--out` never writes through a symlink; `--compare` files are untrusted data; `--src` never follows symlinks; shared reports contain no absolute local paths.
- **No third parties:** only the audited site is contacted. Project code is never executed.

Known limits: `--build` serves the compiled files only. Hosting rules (rewrites, redirects, headers, edge logic) are not applied, so URLs your host serves through them show up as 404, and HTTPS and bot access are not evaluated; the report says so, and the deployed site should be audited again after publishing. A hardlink placed inside a build folder by someone with local access to the machine is served like any file. If you audit a folder you do not trust, do it in a disposable environment.

## Development

```bash
npm test          # unit + integration tests (local fixture servers, Next.js fixtures)
npm run corpus    # audit the real-world corpus and list the most frequent findings (find false positives)
./scripts/clone-source-corpus.sh ./source-corpus && npm run source-corpus -- ./source-corpus   # review 20 real open-source projects of every framework
npm run docs      # regenerate references/standard.*.md from the catalog
```

To add a check: add it to `catalog.mjs` (bilingual text, tier, basis, source), emit it from `url-checks.mjs` or `next-checks.mjs`, add a test, run `npm run docs`. Heuristic checks must not be blockers (enforced by a test).

## License

MIT
