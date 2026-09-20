/**
 * Browser bridge — lets the UI feed Optimizely Graph responses into this runtime.
 *
 * Optimizely Graph is the only thing a page needs, but the runtime rendering the
 * page does not always have network access to `cg.optimizely.com` (offline dev,
 * firewalled CI, sandboxed preview). When a query cannot be executed, the client
 * in `lib/optimizely/client.ts` writes it to `.cms-cache/pending/`. The
 * `/cms-bridge` page reads the queue here, runs each query **from the browser**
 * (which usually *can* reach Graph) and posts the response back.
 *
 * GET  → advances the query plan (one step) and returns what still needs running
 * POST → stores a captured response, then returns the refreshed queue
 */

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getConfigStatus, optimizelyConfig } from '@/lib/optimizely/config'
import { clearResults, listPending, readPending, writeResult } from '@/lib/optimizely/store'
import { getGlobalSettings, selectGlobalConfigItem } from '@/lib/optimizely/global-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function queueStatus() {
  // Render the global settings again: anything still missing is (re)queued, and
  // whatever was captured in the meantime is picked up from the local cache.
  const settings = await getGlobalSettings()
  const pending = await listPending()

  return {
    endpoint: optimizelyConfig.apiUrl,
    serverKey: optimizelyConfig.singleKey ?? null,
    // The key never leaves the browser when it is not configured server-side.
    hasServerKey: Boolean(optimizelyConfig.singleKey),
    config: getConfigStatus(),
    pending,
    settings: {
      source: settings.status.source,
      error: settings.status.error ?? null,
      typeName: settings.meta.typeName ?? null,
      displayName: settings.meta.displayName ?? null,
      key: settings.meta.key ?? null,
      propertyCount: settings.fields.length,
    },
  }
}

export async function GET() {
  try {
    return NextResponse.json(await queueStatus())
  } catch (error) {
    return NextResponse.json({ error: String(error), pending: [] }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: 'capture' | 'reset' | 'select'
      id?: string
      response?: unknown
      key?: string
      typeName?: string
    }

    if (body.action === 'reset') {
      await clearResults()
      revalidateTag('optimizely')
      revalidatePath('/', 'layout')
      return NextResponse.json({ ok: true, ...(await queueStatus()) })
    }

    if (body.action === 'select') {
      if (!body.key) {
        return NextResponse.json({ ok: false, error: 'missing key' }, { status: 400 })
      }
      await selectGlobalConfigItem(body.key, body.typeName)
      revalidateTag('optimizely')
      revalidatePath('/', 'layout')
      return NextResponse.json({ ok: true, ...(await queueStatus()) })
    }

    const id = String(body.id ?? '')
    const queued = await readPending(id)
    if (!queued) {
      return NextResponse.json({ ok: false, error: 'unknown request id' }, { status: 404 })
    }

    await writeResult(
      { id: queued.id, label: queued.label, query: queued.query, variables: queued.variables },
      (body.response ?? {}) as Record<string, unknown>,
      'browser-bridge'
    )

    revalidateTag('optimizely')
    revalidatePath('/', 'layout')

    return NextResponse.json({
      ok: true,
      captured: { id: queued.id, label: queued.label },
      ...(await queueStatus()),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error), pending: [] }, { status: 500 })
  }
}
