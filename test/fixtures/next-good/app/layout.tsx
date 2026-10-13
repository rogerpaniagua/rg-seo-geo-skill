import type { Metadata } from 'next'
export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: { default: 'Example', template: '%s | Example' },
  description: 'An example site.',
  openGraph: { title: 'Example', images: ['/og.png'] },
}
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><head><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: '{}' }} /></head><body>{children}</body></html>)
}
