import Link from 'next/link'
import type { SiteSettings } from '@/lib/optimizely/global-config'

/** Site footer rendered from the CMS global settings: columns, contact, legal, copyright. */
export default function SiteFooter({ settings }: { settings: SiteSettings }) {
  const { footerColumns, socialLinks, legalLinks, contact, copyright, siteName, tagline } = settings

  return (
    <footer className="mt-20 bg-brand-900 text-brand-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <p className="text-lg font-bold">{siteName ?? 'Untitled site'}</p>
          {tagline ? <p className="mt-2 text-sm text-brand-100/80">{tagline}</p> : null}
          <div className="mt-4 space-y-1 text-sm text-brand-100/90">
            {contact.email ? (
              <p>
                <a href={`mailto:${contact.email}`} className="hover:text-white">
                  {contact.email}
                </a>
              </p>
            ) : null}
            {contact.phone ? <p>{contact.phone}</p> : null}
            {contact.address ? <p className="max-w-56 text-brand-100/70">{contact.address}</p> : null}
            {contact.hours ? <p className="text-brand-100/70">{contact.hours}</p> : null}
          </div>
        </div>

        {footerColumns.map((column, index) => (
          <div key={`column-${index}`}>
            {column.title ? <p className="text-sm font-semibold uppercase tracking-wide text-accent-400">{column.title}</p> : null}
            <ul className="mt-4 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={`${link.label ?? ''}-${link.href}`}>
                  <Link href={link.href} className="text-brand-100/90 transition hover:text-white">
                    {link.label ?? link.href}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 text-sm text-brand-100/80 md:flex-row">
          <p>{copyright ?? `© ${new Date().getFullYear()} ${siteName ?? ''}`}</p>
          <div className="flex flex-wrap items-center gap-4">
            {legalLinks.map((link) => (
              <Link key={`${link.label ?? ''}-${link.href}`} href={link.href} className="transition hover:text-white">
                {link.label ?? link.href}
              </Link>
            ))}
            {socialLinks.map((link) => (
              <a
                key={`${link.label ?? ''}-${link.href}`}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-white"
              >
                {link.label ?? link.href}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
