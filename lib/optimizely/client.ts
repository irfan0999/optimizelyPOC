/**
 * Thin Optimizely Graph client.
 *
 * Request flow for every query:
 *   1. live POST to Optimizely Graph   → renders + refreshes the local cache
 *   2. last captured response on disk  → keeps the site rendering when Graph is
 *      unreachable (offline dev, CI, network-restricted sandboxes)
 *
 * Nothing here throws for a CMS problem: callers get a result object with the
 * `source` the content was rendered from, which the UI surfaces.
 */

import { graphEndpoint, optimizelyConfig } from './config'
import { GraphRequest, readResult, writeResult } from './store'

export type QuerySource = 'live' | 'cache' | 'none'

export interface GraphErrorPayload {
  data?: unknown
  errors?: unknown[]
}

export interface QueryOutcome<T> {
  ok: boolean
  /** The GraphQL `data` field (already unwrapped from the response envelope). */
  data?: T
  errors?: unknown[]
  source: QuerySource
  fetchedAt?: string
  error?: string
}

export interface QueryOptions {
  /** Use the draft/preview credentials and bypass caches. */
  preview?: boolean
  /** Next.js cache tag for on-demand revalidation. */
  tag?: string
  /** Seconds to keep the live response warm (0 = always revalidate). */
  revalidate?: number
}

/**
 * Optimizely Graph errors that mean "this query shape is not supported here"
 * rather than "the content is missing", so callers can try the next candidate.
 */
export function isShapeError(message: string | undefined): boolean {
  if (!message) return false
  return /cannot query field|unknown argument|unknown field|is not defined by type|did you mean/i.test(message)
}

export function hasGraphErrors(payload: { errors?: unknown[] } | undefined | null): boolean {
  return Array.isArray(payload?.errors) && payload.errors.length > 0
}

export function errorSummary(payload: { errors?: unknown[] } | undefined | null): string {
  if (!hasGraphErrors(payload)) return ''
  return (payload?.errors ?? [])
    .map((error) => {
      if (typeof error === 'string') return error
      const message = (error as { message?: string })?.message
      return message ?? JSON.stringify(error)
    })
    .join('; ')
}

function toOutcomeState(errors: unknown[] | undefined): string {
  return errors && errors.length ? errorSummary({ errors }) : ''
}

async function postToGraph<T>(
  request: GraphRequest,
  { preview, tag, revalidate = optimizelyConfig.revalidate }: QueryOptions
): Promise<{ outcome: QueryOutcome<T>; payload: GraphErrorPayload | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (preview && optimizelyConfig.previewSecret) {
    headers.Authorization = `Basic ${optimizelyConfig.previewSecret}`
  }

  try {
    const response = await fetch(graphEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: request.query, variables: request.variables ?? {} }),
      ...(preview
        ? { cache: 'no-store' as const }
        : revalidate > 0
          ? { next: { revalidate, tags: tag ? [tag, 'optimizely'] : ['optimizely'] } }
          : { cache: 'no-store' as const }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return {
        payload: null,
        outcome: {
          ok: false,
          source: 'none',
          error: `Optimizely Graph responded ${response.status} ${response.statusText}${
            body ? ` — ${body.slice(0, 300)}` : ''
          }`,
        },
      }
    }

    const payload = (await response.json()) as GraphErrorPayload
    return {
      payload,
      outcome: {
        ok: !hasGraphErrors(payload),
        data: payload.data as T,
        errors: payload.errors,
        source: 'live',
        fetchedAt: new Date().toISOString(),
        error: toOutcomeState(payload.errors),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return {
      payload: null,
      outcome: { ok: false, source: 'none', error: `Cannot reach Optimizely Graph (${message})` },
    }
  }
}

export async function runQuery<T = Record<string, unknown>>(
  request: GraphRequest,
  options: QueryOptions = {}
): Promise<QueryOutcome<T>> {
  const { preview = false } = options
  let liveError: string | undefined

  if (!optimizelyConfig.offline && optimizelyConfig.apiUrl) {
    const { outcome: live } = await postToGraph<T>(request, { ...options, preview })

    if (live.source === 'live') {
      const previous = await readResult<T>(request.query, request.variables)
      const previousUsable = previous ? !hasGraphErrors(previous.response) : false

      // A query that errored must never overwrite a payload that used to work —
      // the cached copy is what keeps the site rendering.
      if (live.ok || !previousUsable) {
        await writeResult(request, { data: live.data, errors: live.errors }, 'server')
        return live
      }
      // Fall through: render the last usable capture instead of an error state.
    } else {
      liveError = live.error
    }
  } else {
    liveError = optimizelyConfig.offline
      ? 'Offline mode is enabled (OPTIMIZELY_OFFLINE=1).'
      : 'OPTIMIZELY_API_URL is not configured.'
  }

  const cached = await readResult<T>(request.query, request.variables)
  if (cached) {
    const errors = cached.response.errors
    return {
      ok: !hasGraphErrors(cached.response),
      data: cached.response.data as T,
      errors,
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      error: toOutcomeState(errors),
    }
  }

  return {
    ok: false,
    source: 'none',
    error: liveError ?? 'unknown error',
  }
}
