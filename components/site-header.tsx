import Link from 'next/link'
import type { SiteSettings } from '@/lib/optimizely/global-config'

/**
 * Site header rendered entirely from the Optimizely CMS global settings:
 * logo, site name, navigation, contact phone and the primary call to action.
 */
export default function SiteHeader({ settings }: { settings: SiteSettings }) {
  const { logo, siteName, navigation, cta, login, appointment, contact, announcement } = settings

  return (
    <header className="sticky top-0 z-30">
      {announcement?.enabled && announcement.text ? (
        <div className="bg-brand-800 text-brand-50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2 px-6 py-2 text-center text-sm">
            <span>{announcement.text}</span>
            {announcement.href ? (
              <Link href={announcement.href} className="font-semibold text-accent-400 underline">
                Learn more
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
          <Link href="/" className="flex items-center gap-3">
            {logo?.url ? (
              // CMS media can be served from any host, so next/image would need a
              // per-instance remotePatterns entry — a plain img keeps the POC portable.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.url}
                alt={logo.alt ?? siteName ?? 'Logo'}
                width={logo.width ?? 40}
                height={logo.height ?? 40}
                className="h-10 w-10 rounded-xl object-contain"
              />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
                {(siteName ?? 'C').slice(0, 1)}
              </span>
            )}
            <span className="text-lg font-bold text-brand-800">{siteName ?? 'Untitled site'}</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {navigation.map((item) => (
              <Link
                key={`${item.label ?? ''}-${item.href}`}
                href={item.href}
                className="text-sm font-medium text-slate-700 transition hover:text-brand-700"
              >
                {item.label ?? item.href}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            {contact.phone ? (
              <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="hidden text-sm font-medium text-slate-600 lg:block">
                {contact.phone}
              </a>
            ) : null}
            {login ? (
              <Link href={login.href} className="hidden text-sm font-medium text-slate-600 transition hover:text-brand-700 sm:block">
                {login.label ?? 'Login'}
              </Link>
            ) : null}
            {appointment ? (
              <Link
                href={appointment.href}
                className="rounded-full border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                {appointment.label ?? 'Appointment'}
              </Link>
            ) : null}
            {cta ? (
              <Link
                href={cta.href}
                className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-600"
              >
                {cta.label ?? 'Get started'}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
