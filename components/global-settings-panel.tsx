import type { SiteSettings } from '@/lib/optimizely/global-config'
import { stripHtml } from '@/lib/optimizely/normalize'

const KIND_STYLES: Record<string, string> = {
  text: 'bg-brand-50 text-brand-700',
  html: 'bg-indigo-50 text-indigo-700',
  link: 'bg-sky-50 text-sky-700',
  links: 'bg-sky-50 text-sky-700',
  image: 'bg-violet-50 text-violet-700',
  list: 'bg-amber-50 text-amber-700',
  boolean: 'bg-emerald-50 text-emerald-700',
  number: 'bg-emerald-50 text-emerald-700',
  empty: 'bg-slate-100 text-slate-500',
  json: 'bg-slate-100 text-slate-600',
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="max-w-[60%] truncate text-right text-sm font-medium text-slate-900" title={String(value ?? '')}>
        {value ?? <span className="font-normal text-slate-400">—</span>}
      </dd>
    </div>
  )
}

/**
 * Everything that came back from the CMS for the global settings item — mapped
 * values first, then the raw properties exactly as Optimizely Graph returned
 * them. Handy while modelling content: whatever you add in the CMS shows up here
 * without a code change.
 */
export default function GlobalSettingsPanel({ settings }: { settings: SiteSettings }) {
  const { meta, fields, raw } = settings

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Content from the CMS</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">Global settings — every property in Optimizely Graph</h2>
        <p className="mt-2 text-sm text-slate-600">
          {fields.length} properties on <span className="font-medium">{meta.typeName ?? 'unknown type'}</span>
          {meta.urlPath ? (
            <>
              {' '}
              ·{' '}
              <span className="font-mono text-xs text-slate-500">{meta.urlPath}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-8 px-6 py-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Item metadata</h3>
          <dl className="mt-3">
            <Row label="Display name" value={meta.displayName} />
            <Row label="Content type" value={meta.typeName} />
            <Row label="Content key" value={meta.key} />
            <Row label="Locale" value={meta.locale} />
            <Row label="Status" value={meta.status} />
            <Row label="Version" value={meta.version} />
            <Row label="Last modified" value={meta.lastModified ? new Date(meta.lastModified).toLocaleString() : undefined} />
            <Row label="Types" value={meta.types.join(', ')} />
          </dl>

          <h3 className="mt-6 text-sm font-semibold text-slate-900">Mapped into the site</h3>
          <dl className="mt-3">
            <Row label="Site name" value={settings.siteName} />
            <Row label="Tagline" value={settings.tagline} />
            <Row label="Logo" value={settings.logo?.url ? 'set' : undefined} />
            <Row label="Navigation links" value={settings.navigation.length} />
            <Row label="Call to action" value={settings.cta ? `${settings.cta.label ?? ''} → ${settings.cta.href}` : undefined} />
            <Row label="Footer columns" value={settings.footerColumns.length} />
            <Row label="Social links" value={settings.socialLinks.length} />
            <Row label="Legal links" value={settings.legalLinks.length} />
            <Row label="Contact e-mail" value={settings.contact.email} />
            <Row label="Contact phone" value={settings.contact.phone} />
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Raw properties</h3>
          <p className="mt-1 text-xs text-slate-500">
            Straight from Optimizely Graph. Use the property names on the left in{' '}
            <code className="rounded bg-slate-100 px-1">lib/optimizely/field-map.ts</code> to pin a mapping.
          </p>
          <ul className="mt-4 space-y-2">
            {fields.map((field) => (
              <li key={field.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-sm font-semibold text-slate-900">{field.key}</code>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLES[field.kind] ?? KIND_STYLES.json}`}>
                    {field.kind}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-600" title={field.preview}>
                  {field.preview || '—'}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">Raw value</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                    {JSON.stringify(field.value, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
            {!fields.length ? <li className="text-sm text-slate-500">No properties returned.</li> : null}
          </ul>

          {settings.html && Object.keys(settings.html).length ? (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">Rendered XHTML properties</summary>
              <div className="mt-3 space-y-3">
                {Object.entries(settings.html).map(([key, html]) => (
                  <div key={key} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-mono text-xs text-slate-500">{key}</p>
                    <div
                      className="mt-1 text-sm text-slate-700 [&_a]:text-brand-700 [&_a]:underline [&_h2]:mt-2 [&_h2]:font-semibold [&_li]:ml-4 [&_p]:mt-1"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-500">Plain text preview</summary>
                      <p className="mt-1 text-xs text-slate-600">{stripHtml(html)}</p>
                    </details>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Complete Graph payload</summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </section>
  )
}
