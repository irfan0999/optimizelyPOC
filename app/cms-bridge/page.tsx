import { notFound } from 'next/navigation'
import Link from 'next/link'
import CmsBridge from '@/components/cms-bridge'
import { optimizelyConfig } from '@/lib/optimizely/config'

/**
 * Development tool: capture Optimizely Graph responses from a browser that can
 * reach `cg.optimizely.com` and store them for the runtime rendering the site.
 * Disabled in production unless OPTIMIZELY_ENABLE_CMS_BRIDGE=1.
 */
export const dynamic = 'force-dynamic'

export default function CmsBridgePage() {
  if (!optimizelyConfig.bridgeEnabled) {
    notFound()
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Development tool</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Optimizely Graph browser bridge</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        This runtime can only render content it has local access to. Whenever a Graph query cannot be executed here it
        is queued, and this page replays it from your browser — which normally <em>can</em> reach Optimizely Graph. The
        captured responses are cached locally (<code className="rounded bg-slate-100 px-1">.cms-cache/</code>, or a
        temporary directory / memory when the project folder is read-only) so every page renders with real CMS content.
      </p>
      <div className="mt-8">
        <CmsBridge endpoint={optimizelyConfig.apiUrl} serverKey={optimizelyConfig.singleKey ?? null} />
      </div>
      <p className="mt-8 text-sm text-slate-500">
        Once the queue is empty, go back to the{' '}
        <Link href="/" className="font-medium text-brand-700 underline">
          home page
        </Link>{' '}
        — the global settings will be rendered from the captured CMS content.
      </p>
    </main>
  )
}
