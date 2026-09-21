import { revalidatePath } from 'next/cache'
import {
  getSelectedGlobalConfigItem,
  selectGlobalConfigItem,
  type SiteSettings,
} from '@/lib/optimizely/global-config'
import { getConfigStatus } from '@/lib/optimizely/config'

const SOURCE_STYLES: Record<SiteSettings['status']['source'], { label: string; className: string; hint: string }> = {
  live: {
    label: 'Live',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hint: 'Rendered straight from Optimizely Graph.',
  },
  cache: {
    label: 'Captured',
    className: 'bg-sky-50 text-sky-700 border-sky-200',
    hint: 'Rendered from a response captured earlier.',
  },
  none: {
    label: 'Unavailable',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
    hint: 'The content could not be loaded.',
  },
}

/**
 * Explains where the rendered global settings came from and, when the configured
 * GUID does not resolve, lets the developer pin the right content item.
 */
export default async function CmsSourceCard({ settings }: { settings: SiteSettings }) {
  const status = SOURCE_STYLES[settings.status.source]
  const config = getConfigStatus()
  const selection = await getSelectedGlobalConfigItem()

  async function pickItem(formData: FormData) {
    'use server'
    const key = String(formData.get('key') ?? '')
    const typeName = String(formData.get('typeName') ?? '')
    if (key) await selectGlobalConfigItem(key, typeName || undefined)
    revalidatePath('/', 'layout')
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
          <h2 className="text-lg font-semibold text-slate-900">Where this content comes from</h2>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-600">{status.hint}</p>

      {settings.status.source !== 'live' && settings.status.error ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-600">{settings.status.error}</p>
      ) : null}

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
          <dt className="text-slate-500">Graph endpoint</dt>
          <dd className="font-mono text-xs text-slate-700">configured</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
          <dt className="text-slate-500">Single key</dt>
          <dd className="font-medium text-slate-900">{config.missing.includes('OPTIMIZELY_SINGLE_KEY') ? 'not set' : 'set'}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
          <dt className="text-slate-500">Global settings ID</dt>
          <dd className="font-mono text-xs text-slate-700">{settings.meta.key ?? 'not set'}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
          <dt className="text-slate-500">Query</dt>
          <dd className="max-w-[60%] truncate text-right font-mono text-xs text-slate-700">{settings.status.queryLabel ?? '—'}</dd>
        </div>
        {settings.status.fetchedAt ? (
          <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
            <dt className="text-slate-500">Captured</dt>
            <dd className="text-slate-700">{new Date(settings.status.fetchedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {selection ? (
          <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
            <dt className="text-slate-500">Pinned item</dt>
            <dd className="font-mono text-xs text-slate-700">{selection.key}</dd>
          </div>
        ) : null}
      </dl>

      {settings.candidateItems.length ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            The configured content key did not resolve, but these global settings items exist in the CMS:
          </p>
          <ul className="mt-3 space-y-2">
            {settings.candidateItems.map((item) => (
              <li key={item._metadata?.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item._metadata?.displayName ?? '(no name)'}</p>
                  <p className="font-mono text-xs text-slate-500">
                    {item._metadata?.types?.join(' · ')} · {item._metadata?.key}
                  </p>
                </div>
                <form action={pickItem}>
                  <input type="hidden" name="key" value={item._metadata?.key ?? ''} />
                  <input type="hidden" name="typeName" value={(item._metadata?.types ?? []).find((type) => !type.startsWith('_')) ?? ''} />
                  <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                    Use this item
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}


    </section>
  )
}
