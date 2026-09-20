import Link from 'next/link'
import CmsSourceCard from '@/components/cms-source-card'
import GlobalSettingsPanel from '@/components/global-settings-panel'
import { getSiteSettings } from '@/lib/optimizely/global-config'
import { optimizelyConfig } from '@/lib/optimizely/config'

export const revalidate = 300

/**
 * Home page. Every string and link on it — including the header and footer in
 * `app/layout.tsx` — is rendered from the Optimizely CMS global settings item
 * configured with OPTIMIZELY_GLOBAL_CONFIG_ID.
 */
export default async function Home() {
  const settings = await getSiteSettings()

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-8 py-14 text-white shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-100">Optimizely CMS · global settings</p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{settings.siteName ?? 'Medicare'}</h1>
        {settings.tagline ? <p className="mt-4 max-w-2xl text-lg text-brand-50/90">{settings.tagline}</p> : null}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {settings.cta ? (
            <Link
              href={settings.cta.href}
              className="rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-600"
            >
              {settings.cta.label ?? 'Get started'}
            </Link>
          ) : null}
          {settings.contact.phone ? (
            <a
              href={`tel:${settings.contact.phone.replace(/[^+\d]/g, '')}`}
              className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Talk to us · {settings.contact.phone}
            </a>
          ) : null}
        </div>

        <dl className="mt-10 grid gap-6 border-t border-white/20 pt-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-100/80">Navigation</dt>
            <dd className="mt-1 text-sm text-white/90">
              {settings.navigation.length ? settings.navigation.map((item) => item.label ?? item.href).join(' · ') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-100/80">Footer columns</dt>
            <dd className="mt-1 text-sm text-white/90">
              {settings.footerColumns.length ? settings.footerColumns.map((column) => column.title ?? 'Untitled').join(' · ') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-100/80">Support</dt>
            <dd className="mt-1 text-sm text-white/90">
              {settings.contact.email ?? '—'}
              {settings.contact.hours ? ` · ${settings.contact.hours}` : ''}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-10 space-y-6">
        <CmsSourceCard settings={settings} />
        <GlobalSettingsPanel settings={settings} />
      </div>

      <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold text-slate-900">How this page is wired</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">OPTIMIZELY_GLOBAL_CONFIG_ID</code> holds the
            content key of the global settings item (here: <span className="font-mono text-xs">{settings.meta.key ?? 'not set'}</span>).
          </li>
          <li>The key is looked up in Optimizely Graph and its content type is read from <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">_metadata.types</code>.</li>
          <li>The Graph schema is introspected, so the query asks for <em>every</em> property of that content type — add a property in the CMS and it appears here without a code change.</li>
          <li>Values are normalised (string, XHTML, link, content reference, block list…) and mapped to the header, footer and page copy.</li>
          {optimizelyConfig.bridgeEnabled ? (
            <li>
              If Graph cannot be reached from this runtime the queries are queued and can be captured from a browser on{' '}
              <Link href="/cms-bridge" className="font-medium text-brand-700 underline">
                /cms-bridge
              </Link>
              .
            </li>
          ) : null}
        </ol>
      </section>
    </main>
  )
}
