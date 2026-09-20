import type { Metadata } from 'next'
import './globals.css'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { getSiteSettings } from '@/lib/optimizely/global-config'
import { siteUrl } from '@/lib/optimizely/config'

/** Site-wide content is CMS driven — refresh it every 5 minutes unless a capture revalidates it. */
export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  const title = [settings.siteName, settings.tagline].filter(Boolean).join(' — ')

  const logo = settings.logo?.url
  const absoluteLogo = logo && /^https?:\/\//i.test(logo) ? logo : undefined

  return {
    metadataBase: siteUrl(),
    title: title || 'Medicare — Your Health, Our Priority',
    description:
      settings.tagline ??
      'Medicare healthcare POC — headless frontend powered by Optimizely CMS and Optimizely Graph.',
    openGraph: {
      title: title || 'Medicare',
      description: settings.tagline ?? undefined,
      images: absoluteLogo ? [{ url: absoluteLogo }] : undefined,
    },
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Header and footer come from the CMS global settings item.
  const settings = await getSiteSettings()

  return (
    <html lang={settings.meta.locale ?? 'en'}>
      <body className="antialiased">
        <SiteHeader settings={settings} />
        {children}
        <SiteFooter settings={settings} />
      </body>
    </html>
  )
}
