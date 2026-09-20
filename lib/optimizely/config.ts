/**
 * Environment-driven configuration for the Optimizely Graph integration.
 *
 * Everything the app needs to talk to Optimizely Graph (and to the CMS content
 * it should render) is read from here, so the rest of the code never touches
 * `process.env` directly.
 */

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

/** Strip wrapping quotes editors sometimes leave in .env files. */
function unquote(value: string | undefined): string | undefined {
  if (!value) return value
  return value.replace(/^["']|["']$/g, '')
}

export const optimizelyConfig = {
  /** GraphQL endpoint, e.g. https://cg.optimizely.com/content/v2 */
  apiUrl: unquote(readEnv('OPTIMIZELY_API_URL')) ?? 'https://cg.optimizely.com/content/v2',
  /** Single key for published content (CMS > Settings > API Keys). */
  singleKey: unquote(readEnv('OPTIMIZELY_SINGLE_KEY')),
  /** Base64(AppKey:AppSecret) — required for draft/preview content. */
  previewSecret: unquote(readEnv('OPTIMIZELY_PREVIEW_SECRET')),
  /** Content key (GUID) of the GlobalConfig content item that holds site settings. */
  globalConfigId: unquote(readEnv('OPTIMIZELY_GLOBAL_CONFIG_ID')),
  /** Public CMS instance URL (preview / OPE scripts). */
  cmsUrl: unquote(readEnv('NEXT_PUBLIC_CMS_URL')),
  /** Optional locale to pin the global settings query to. */
  defaultLocale: unquote(readEnv('OPTIMIZELY_DEFAULT_LOCALE')),
  /** Force the offline (cached / browser-bridge) code path. */
  offline: readEnv('OPTIMIZELY_OFFLINE') === '1',
  /** Seconds the Graph responses stay warm in Next's data cache. */
  revalidate: Number(readEnv('OPTIMIZELY_REVALIDATE') ?? 300),
  /** Optional directory for captured Graph responses (defaults to `<project>/.cms-cache`). */
  cacheDir: unquote(readEnv('OPTIMIZELY_CACHE_DIR')),
  /**
   * The browser bridge (`/cms-bridge` + `/api/cms-bridge`) is a development tool:
   * it is only served in production when explicitly enabled.
   */
  bridgeEnabled: process.env.NODE_ENV !== 'production' || readEnv('OPTIMIZELY_ENABLE_CMS_BRIDGE') === '1',
} as const

/**
 * Absolute URL of the site, used for `metadataBase` (canonical / Open Graph URLs).
 *
 * Accepts `NEXT_PUBLIC_SITE_URL` with or without a scheme, falls back to the
 * URL Vercel injects for the deployment, then to localhost. It never throws —
 * an invalid value used to fail the build with `TypeError: Invalid URL`.
 */
export function siteUrl(): URL {
  const candidates = [
    unquote(readEnv('NEXT_PUBLIC_SITE_URL')),
    readEnv('VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'),
    'http://localhost:3000',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`
    try {
      return new URL(withScheme)
    } catch {
      // Try the next candidate.
    }
  }
  return new URL('http://localhost:3000')
}

export interface ConfigStatus {
  configured: boolean
  missing: string[]
  graphQlReady: boolean
}

export function getConfigStatus(): ConfigStatus {
  const missing: string[] = []
  if (!optimizelyConfig.singleKey) missing.push('OPTIMIZELY_SINGLE_KEY')
  if (!optimizelyConfig.globalConfigId) missing.push('OPTIMIZELY_GLOBAL_CONFIG_ID')

  return {
    configured: missing.length === 0,
    missing,
    // A browser-bridge capture can supply data without a server-side key, so the
    // Graph endpoint alone is enough to be "reachable".
    graphQlReady: Boolean(optimizelyConfig.apiUrl),
  }
}

export function graphEndpoint(): string {
  const { apiUrl, singleKey } = optimizelyConfig
  if (!singleKey) return apiUrl
  const separator = apiUrl.includes('?') ? '&' : '?'
  return `${apiUrl}${separator}auth=${encodeURIComponent(singleKey)}`
}

/**
 * The content key stored in Optimizely Graph is a 32 character hex string
 * without dashes, while CMS/Graph editors usually copy it with dashes. Try both
 * forms (and the raw value) so a pasted GUID always resolves.
 */
export function contentKeyCandidates(id: string | undefined = optimizelyConfig.globalConfigId): string[] {
  if (!id) return []
  const trimmed = id.trim()
  const compact = trimmed.replace(/-/g, '')
  // Graph stores content keys as 32 hex characters without dashes, while the CMS
  // usually copies them with dashes — try the Graph form first.
  const candidates = new Set<string>([compact, trimmed])
  if (compact.length === 32) {
    candidates.add(
      `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
    )
  }
  return [...candidates]
}
