# Contributing

Thanks for helping. This project is deliberately small and strict: **deterministic, transparent, honest about uncertainty.**

## Principles

1. **No invented numbers.** There is no composite score on purpose. A check is pass / warn / fail with evidence.
2. **Every check carries its basis.** `official` (stated in Google or framework docs, with a link), `measured` (a verifiable fact) or
   `heuristic` (community practice). Heuristics can never be blockers, and a test enforces it.
3. **Verify before you assert.** Facts about a framework or about Google must come from its official documentation, with the link in `source`.
4. **False positives are bugs.** A noisy check erodes trust. Calibrate against real projects, not only fixtures.

## Adding or changing a check

1. Add it to `skills/rg-seo-geo-skill/scripts/lib/catalog.mjs` (English + Spanish text, tier, basis, source URL).
2. Write the failing test first (`test/`), then emit the check from `url-checks.mjs`, `next-checks.mjs` or an adapter in `lib/source/`.
3. `npm test` must pass, then `npm run docs` to regenerate the standard.
4. Run it on real sites or projects (`npm run corpus`, `npm run source-corpus`) and read every finding it produces.

## Security

Anything that touches network access, parsing or file writing needs an adversarial test as well (see `test/security*.test.mjs`).
Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Style

Zero runtime dependencies. Node 18+. Linear-time parsing only: no regular expression with nested or lazy quantifiers over
documents written by third parties.
