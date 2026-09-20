/**
 * Built-in sample payload for the global settings content item.
 *
 * It is only used when Optimizely Graph cannot be reached *and* no response has
 * been captured yet (offline dev, CI, network-restricted sandbox), so the app
 * still renders instead of showing an error page. The UI labels it clearly as
 * sample data and links to `/cms-bridge` to capture the real content.
 *
 * The shape mirrors what Optimizely Graph returns, so it exercises exactly the
 * same normalisation path as live CMS content.
 */

export const SAMPLE_CONTENT_KEY = '41def1d7-5c9e-468a-bd4f-4062e307566b'

const LOGO_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f7a7e"/><path d="M32 15c-4.6 0-8 3.6-8 7.8 0 5.6 8 16.2 8 16.2s8-10.6 8-16.2c0-4.2-3.4-7.8-8-7.8z" fill="#f5b544"/><path d="M22 42h8v6h4v-6h8v-4h-8v-6h-4v6h-8z" fill="#ffffff"/></svg>`
  )

const raw = {
  siteName: 'Medicare',
  tagline: 'Your health, our priority',
  logo: {
    url: { default: LOGO_SVG },
    alt: 'Medicare',
    width: 64,
    height: 64,
  },
  navigation: [
    { label: 'Plans', href: '/plans' },
    { label: 'Providers', href: '/providers' },
    { label: 'Resources', href: '/resources' },
    { label: 'About', href: '/about' },
  ],
  ctaText: 'Find a plan',
  ctaHref: '/plans',
  contactEmail: 'hello@medicare.example',
  contactPhone: '+1 (800) 555-0134',
  contactAddress: '1200 Wellness Way, Suite 400, Springfield, IL 62704',
  openingHours: 'Mon–Fri, 8:00–18:00 CT',
  socialLinks: [
    { platform: 'Facebook', href: 'https://facebook.com/medicare' },
    { platform: 'LinkedIn', href: 'https://linkedin.com/company/medicare' },
    { platform: 'YouTube', href: 'https://youtube.com/@medicare' },
  ],
  footerColumns: [
    {
      title: 'Company',
      links: [
        { label: 'About us', href: '/about' },
        { label: 'Careers', href: '/careers' },
        { label: 'Newsroom', href: '/newsroom' },
      ],
    },
    {
      title: 'Support',
      links: [
        { label: 'Contact us', href: '/contact' },
        { label: 'Member help', href: '/help' },
        { label: 'Find a provider', href: '/providers' },
      ],
    },
    {
      title: 'Plans',
      links: [
        { label: 'Medicare Advantage', href: '/plans/advantage' },
        { label: 'Prescription drug plans', href: '/plans/part-d' },
        { label: 'Supplemental insurance', href: '/plans/supplement' },
      ],
    },
  ],
  legalLinks: [
    { label: 'Privacy policy', href: '/legal/privacy' },
    { label: 'Terms of use', href: '/legal/terms' },
    { label: 'Accessibility', href: '/legal/accessibility' },
  ],
  copyrightText: '© 2026 Medicare Health Group. All rights reserved.',
}

const metadata = {
  key: SAMPLE_CONTENT_KEY,
  displayName: 'GlobalConfigDefault',
  locale: 'en',
  types: ['GlobalConfigDefault', '_Block', '_Content', '_Item'],
  status: 'Published',
  version: '1',
  lastModified: '2026-09-20T00:00:00.000Z',
  url: {
    default: '/settings/global-config/',
    base: 'https://cms.example.com',
    hierarchical: '/settings/global-config/',
    internal: `cms://content/${SAMPLE_CONTENT_KEY}?loc=en&ver=1`,
    graph: `graph://cms/GlobalConfigDefault/${SAMPLE_CONTENT_KEY}`,
    type: 'HIERARCHICAL',
  },
}

export function sampleLookupItem() {
  return {
    __typename: 'GlobalConfigDefault',
    _metadata: metadata,
    Name: metadata.displayName,
    Url: metadata.url.default,
    Status: metadata.status,
    ContentLink: { GuidValue: SAMPLE_CONTENT_KEY, Id: 1, Url: metadata.url.default },
    Language: { Name: 'en', DisplayName: 'English' },
  }
}

export function sampleContentItem(): Record<string, unknown> {
  return {
    __typename: 'GlobalConfigDefault',
    _metadata: metadata,
    ...raw,
  }
}

export const sampleRawFields = raw
