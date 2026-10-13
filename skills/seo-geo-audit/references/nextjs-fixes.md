# Next.js fixes for common findings

Based on the Next.js docs: [Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) and [sitemap.xml](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap). Verify against your installed Next.js version.

## `next.metadata-base` / `next.root-metadata`: one root definition

```tsx
// app/layout.tsx
import type { Metadata } from 'next'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.example.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Brand · what you do', template: '%s | Brand' },
  description: 'One clear sentence (70–160 chars).',
  openGraph: { type: 'website', siteName: 'Brand', locale: 'es_SV' },
  twitter: { card: 'summary_large_image' },
}
```

Define the site URL **once** and reuse it in `sitemap.ts` and `robots.ts` (`next.host-consistency`).

## `next.canonical`: do not set a canonical in the root layout

A `canonical` in the root layout is inherited by every page that does not override it, so each page tells Google "the canonical is the home". Set it per page:

```tsx
// app/work/[slug]/page.tsx
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await getItem(slug)
  return {
    title: item.title,                 // becomes "Title | Brand" through the template
    description: item.summary,
    alternates: { canonical: `/work/${slug}` },   // resolved against metadataBase
    openGraph: { title: item.title, description: item.summary, url: `/work/${slug}` },
  }
}
```

For the home, `alternates: { canonical: '/' }` in `app/page.tsx` (or the layout, if you override it everywhere else).

## `next.sitemap-coverage` / `next.sitemap-lastmod`

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'
import { cases } from './cases'            // your content source

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.example.com'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, lastModified: '2026-10-01' },
    { url: `${SITE}/work`, lastModified: '2026-10-01' },
    ...cases.map((c) => ({ url: `${SITE}/work/${c.slug}`, lastModified: c.updatedAt })),
  ]
}
```

- Use **real** dates (from content), or omit `lastModified`. `new Date()` makes every URL "changed" on every build, so Google stops trusting it.
- `changeFrequency` and `priority` are optional; Google ignores them.
- Do not list URLs that are `noindex` (`crawl.sitemap-noindex`).

## `next.client-page`: keep pages as Server Components

Move hooks and event handlers into small child components marked `'use client'`, and keep `page.tsx` a Server Component so it can export `metadata`.

## `social.og-image`: share image

```tsx
// app/opengraph-image.tsx  (or a static app/opengraph-image.png, 1200×630)
import { ImageResponse } from 'next/og'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export default function Image() {
  return new ImageResponse(<div style={{ display: 'flex', fontSize: 96, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>Brand</div>, size)
}
```

A more specific `opengraph-image` deeper in the tree (e.g. `app/work/[slug]/opengraph-image.tsx`) overrides the root one.

## `crawl.soft-404`

Create `app/not-found.tsx`; call `notFound()` from dynamic pages when the item does not exist.

## Staging vs production

Keep `noindex` behind an environment flag that is **off in production** (e.g. `robots: { index: false }` only when `NEXT_PUBLIC_SITE_NOINDEX=1`), and re-run the audit against the live domain after each launch.
