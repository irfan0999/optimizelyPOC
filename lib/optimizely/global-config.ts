/**
 * Global settings (a.k.a. site settings / global config) from Optimizely CMS.
 *
 * `getGlobalSettings()` is the single entry point used by the layout and by any
 * page that needs site-wide content (header, footer, contact details…).
 *
 * How the content item is located:
 *   1. the content key from `OPTIMIZELY_GLOBAL_CONFIG_ID` is looked up in Graph
 *   2. the concrete content type of that item is read from `_metadata.types`
 *   3. the schema is introspected so the property selection set can be generated
 *      — every property of the content type is fetched, not a hard-coded list
 *   4. the payload is normalised into the `SiteSettings` model
 *
 * Any step that cannot reach Optimizely Graph falls back to the last captured
 * response in `.cms-cache/`.
 */

import { cache } from 'react'
import { contentKeyCandidates, getConfigStatus, optimizelyConfig } from './config'
import {
  ContentLookupItem,
  ContentLookupPayload,
  SchemaIndex,
  contentRequests,
  discoveryRequests,
  findGlobalSettingsTypes,
  itemsByTypeRequest,
  loadSchema,
  pickConcreteType,
} from './schema'
import { readState, writeState } from './store'
import { runQuery } from './client'
import {
  CmsImage,
  CmsLink,
  RawField,
  isPlainObject,
  describeRawFields,
  mapFields,
  toColumns,
  toHtml,
  toImage,
  toLink,
  toLinks,
  toText,
} from './normalize'

export interface GlobalSettingsMeta {
  key?: string
  displayName?: string
  typeName?: string
  types: string[]
  locale?: string
  status?: string
  version?: string
  lastModified?: string
  url?: string
  urlPath?: string
}

export interface SiteSettings {
  siteName?: string
  tagline?: string
  logo?: CmsImage
  favicon?: CmsImage
  navigation: CmsLink[]
  cta?: CmsLink
  /** Secondary header action, e.g. a login link. */
  login?: CmsLink
  /** Primary header action, e.g. a book-appointment link. */
  appointment?: CmsLink
  footerColumns: { title?: string; links: CmsLink[] }[]
  /** Logo rendered inside the footer, when the CMS model has its own. */
  footerLogo?: CmsImage
  footerDescription?: string
  copyright?: string
  socialLinks: CmsLink[]
  legalLinks: CmsLink[]
  contact: {
    email?: string
    phone?: string
    address?: string
    hours?: string
  }
  announcement?: {
    text?: string
    href?: string
    enabled: boolean
  }
  /** Every property returned by Graph, untouched. */
  raw: Record<string, unknown>
  /** The same properties, described for the CMS inspector UI. */
  fields: RawField[]
  /** XHTML properties rendered as HTML (kept separate from the plain text fields). */
  html: Record<string, string>
  meta: GlobalSettingsMeta
  /** Populated when the configured GUID was not found: other global-looking items. */
  candidateItems: ContentLookupItem[]
  status: {
    source: 'live' | 'cache' | 'none'
    fetchedAt?: string
    error?: string
    queryLabel?: string
    retriedKeys?: string[]
  }
}

const RESOLUTION_STATE = 'global-config-resolution'
const SELECTION_STATE = 'global-config-selection'

interface Resolution {
  key: string
  typeName: string
  item: ContentLookupItem
  source: 'live' | 'cache'
  resolvedAt: string
}

/** A developer can pin the item manually from the UI when the GUID lookup fails. */
export async function selectGlobalConfigItem(key: string, typeName?: string): Promise<void> {
  await writeState(SELECTION_STATE, { key, typeName, selectedAt: new Date().toISOString() })
}

export async function getSelectedGlobalConfigItem(): Promise<{ key: string; typeName?: string } | null> {
  return readState<{ key: string; typeName?: string }>(SELECTION_STATE)
}

function itemFrom(payload: ContentLookupPayload | undefined): ContentLookupItem | undefined {
  return payload?._Content?.items?.[0] ?? payload?.Content?.items?.[0]
}

/**
 * Step 1+2 — find the content item and work out its concrete content type.
 * Results are cached on disk so discovery runs once, not on every request.
 */
async function resolveGlobalConfigItem({
  preview,
  retriedKeys,
}: {
  preview: boolean
  retriedKeys: string[]
}): Promise<{ resolution?: Resolution; error?: string }> {
  const selection = await getSelectedGlobalConfigItem()
  const configuredKey = selection?.key ?? optimizelyConfig.globalConfigId
  if (!configuredKey) {
    return { error: 'OPTIMIZELY_GLOBAL_CONFIG_ID is not set — add the content key of your global settings item to .env.local.' }
  }

  const cached = await readState<Resolution>(RESOLUTION_STATE)
  if (cached && !preview && cached.key.toLowerCase() === configuredKey.toLowerCase()) {
    return { resolution: cached }
  }

  const keys = [selection?.key, ...contentKeyCandidates(configuredKey)].filter(Boolean) as string[]
  const uniqueKeys = [...new Set(keys)]
  const shapes = discoveryRequests(uniqueKeys[0])

  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
    let shapeWorked = false

    for (const key of uniqueKeys) {
      const request = discoveryRequests(key)[shapeIndex]
      const outcome = await runQuery<ContentLookupPayload>(request, { preview, tag: 'optimizely-global-settings' })
      retriedKeys.push(key)

      if (outcome.source === 'none') {
        // Nothing cached and Graph is unreachable — surface the error.
        return { error: outcome.error }
      }
      if (!outcome.ok) {
        // This metadata shape does not exist on this Graph instance — try the next one.
        continue
      }

      shapeWorked = true
      const item = itemFrom(outcome.data)
      if (!item) continue

      const types = item._metadata?.types ?? item.ContentType ?? []
      const typeName = selection?.typeName ?? pickConcreteType(types) ?? pickConcreteType([item.__typename ?? item.Name ?? ''])
      if (!typeName) continue

      const resolution: Resolution = {
        key: item._metadata?.key ?? key,
        typeName,
        item,
        source: outcome.source === 'live' ? 'live' : 'cache',
        resolvedAt: new Date().toISOString(),
      }
      await writeState(RESOLUTION_STATE, resolution)
      return { resolution }
    }

    // The metadata shape works but no key candidate matched — look for the item
    // by content type instead of hammering Graph with the same lookup.
    if (shapeWorked) break
  }

  return {
    error: `No content item found for key ${configuredKey}.`,
  }
}

/** Step 3 — search items of content types that look like global settings. */
async function findCandidateItems(schema: SchemaIndex | null, preview: boolean): Promise<ContentLookupItem[]> {
  if (!schema) return []
  const typeNames = findGlobalSettingsTypes(schema)
  const found: ContentLookupItem[] = []

  for (const typeName of typeNames.slice(0, 4)) {
    const outcome = await runQuery<Record<string, { items?: ContentLookupItem[] }>>(itemsByTypeRequest(typeName), {
      preview,
      tag: 'optimizely-global-settings',
    })
    if (outcome.source === 'none') break
    const items = outcome.data?.[typeName]?.items ?? []
    for (const item of items) {
      if (item?._metadata?.key && !found.some((entry) => entry._metadata?.key === item._metadata?.key)) {
        found.push(item)
      }
    }
    if (found.length) break
  }

  found.sort((a, b) => (a._metadata?.displayName ?? '').localeCompare(b._metadata?.displayName ?? ''))
  return found
}

function toMeta(item: ContentLookupItem, typeName: string, key: string): GlobalSettingsMeta {
  const url = item._metadata?.url
  const path = url?.default ?? item.Url
  const base = url?.base ?? ''
  const absolute = path && base ? new URL(path, base).toString() : path

  return {
    key: item._metadata?.key ?? key,
    displayName: item._metadata?.displayName ?? item.Name,
    typeName,
    types: item._metadata?.types ?? item.ContentType ?? [],
    locale: item._metadata?.locale ?? item.Language?.Name,
    status: item._metadata?.status ?? item.Status,
    version: item._metadata?.version,
    lastModified: item._metadata?.lastModified ?? undefined,
    url: absolute,
    urlPath: path,
  }
}

/** Step 4 — turn the Graph payload into the model the UI renders. */
export function normalizeSiteSettings(
  item: Record<string, unknown>,
  meta: GlobalSettingsMeta
): Omit<SiteSettings, 'candidateItems' | 'status'> {
  const settings: {
    siteName?: string
    tagline?: string
    logo?: CmsImage
    favicon?: CmsImage
    navigation: CmsLink[]
    footerColumns: { title?: string; links: CmsLink[] }[]
    footerLogo?: CmsImage
    footerDescription?: string
    socialLinks: CmsLink[]
    legalLinks: CmsLink[]
    copyright?: string
    contact: SiteSettings['contact']
    raw: Record<string, unknown>
    fields: RawField[]
    html: Record<string, string>
  } = {
    navigation: [],
    footerColumns: [],
    socialLinks: [],
    legalLinks: [],
    contact: {},
    raw: {},
    fields: [],
    html: {},
  }

  const rawFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === '_metadata' || key === '__typename') continue
    rawFields[key] = value
  }

  // Models like HeaderSettingsDOC nest the whole footer inside a
  // `FooterSettings` block — hoist its properties so the regular mapping
  // (footer logo, social links, copyright…) sees them at the top level.
  const footerBlockEntry = Object.entries(rawFields).find(([key]) => /^footer(settings)?$/i.test(key))
  if (footerBlockEntry && isPlainObject(footerBlockEntry[1])) {
    delete rawFields[footerBlockEntry[0]]
    for (const [key, value] of Object.entries(footerBlockEntry[1])) {
      rawFields[`FooterSettings_${key}`] = value
    }
  }

  let ctaText: string | undefined
  let ctaHref: string | undefined
  let loginText: string | undefined
  let loginHref: string | undefined
  let appointmentText: string | undefined
  let appointmentHref: string | undefined
  let announcementText: string | undefined
  let announcementHref: string | undefined
  let announcementEnabled: boolean | undefined

  for (const { key, target, value, transform } of mapFields(rawFields)) {
    const normalized = transform(value)

    switch (target) {
      case 'siteName':
        settings.siteName ??= toText(normalized)
        break
      case 'tagline':
        settings.tagline ??= toText(normalized)
        break
      case 'logo':
        settings.logo ??= toImage(normalized)
        break
      case 'favicon':
        settings.favicon ??= toImage(normalized)
        break
      case 'navigation': {
        const links = toLinks(normalized)
        if (links.length) settings.navigation = links
        break
      }
      case 'footerColumns': {
        const columns = toColumns(normalized)
        if (columns.length) settings.footerColumns = columns
        break
      }
      case 'footerLogo':
        settings.footerLogo ??= toImage(normalized)
        break
      case 'footerDescription':
        settings.footerDescription ??= toText(normalized)
        break
      case 'loginText':
        loginText ??= toText(normalized)
        break
      case 'loginHref':
        loginHref ??= toLink(normalized)?.href ?? toText(normalized)
        break
      case 'appointmentText':
        appointmentText ??= toText(normalized)
        break
      case 'appointmentHref':
        appointmentHref ??= toLink(normalized)?.href ?? toText(normalized)
        break
      case 'socialLinks': {
        const links = toLinks(normalized)
        if (links.length) settings.socialLinks = links
        break
      }
      case 'legalLinks': {
        const links = toLinks(normalized)
        if (links.length) settings.legalLinks = links
        break
      }
      case 'copyright':
      case 'footerText':
        settings.copyright ??= toText(normalized)
        break
      case 'contactEmail':
        settings.contact.email ??= toText(normalized)
        break
      case 'contactPhone':
        settings.contact.phone ??= toText(normalized)
        break
      case 'contactAddress':
        settings.contact.address ??= toText(normalized)
        break
      case 'contactHours':
        settings.contact.hours ??= toText(normalized)
        break
      case 'ctaText':
        ctaText ??= toText(normalized)
        break
      case 'ctaHref':
        ctaHref ??= toLink(normalized)?.href ?? toText(normalized)
        break
      case 'announcementText':
        announcementText ??= toText(normalized)
        break
      case 'announcementHref':
        announcementHref ??= toLink(normalized)?.href
        break
      case 'announcementEnabled':
        announcementEnabled ??= typeof normalized === 'boolean' ? normalized : undefined
        break
      default:
        break
    }

    // Any XHTML property is exposed as HTML as well as text.
    const html = toHtml(value)
    if (html) settings.html[key] = html
  }

  settings.raw = rawFields
  settings.fields = describeRawFields(item)

  const cta: CmsLink | undefined = ctaHref || ctaText ? { href: ctaHref ?? '#', label: ctaText } : undefined
  const login: CmsLink | undefined = loginHref || loginText ? { href: loginHref ?? '#', label: loginText } : undefined
  const appointment: CmsLink | undefined =
    appointmentHref || appointmentText ? { href: appointmentHref ?? '#', label: appointmentText } : undefined

  return {
    ...settings,
    siteName: settings.siteName ?? meta.displayName,
    tagline: settings.tagline,
    cta,
    login,
    appointment,
    announcement: announcementText
      ? { text: announcementText, href: announcementHref, enabled: announcementEnabled ?? true }
      : undefined,
    meta,
  }
}

export interface GetGlobalSettingsOptions {
  /** Query draft/preview content instead of the published version. */
  preview?: boolean
}

export async function getGlobalSettings(options: GetGlobalSettingsOptions = {}): Promise<SiteSettings> {
  const { preview = false } = options
  const configStatus = getConfigStatus()
  const retriedKeys: string[] = []

  const { resolution, error } = await resolveGlobalConfigItem({ preview, retriedKeys })

  if (resolution) {
    const schema = await loadSchema()
    const meta = toMeta(resolution.item, resolution.typeName, resolution.key)

    if (!schema.index) {
      return {
        ...normalizeSiteSettings({}, meta),
        candidateItems: [],
        status: {
          source: 'none',
          error:
            schema.error ??
            'The Optimizely Graph schema is not available yet — try again in a moment.',
          retriedKeys,
        },
      }
    }

    const requests = contentRequests(resolution.typeName, resolution.key, schema.index)

    for (const request of requests) {
      const outcome = await runQuery<Record<string, { items?: Record<string, unknown>[] }>>(request, {
        preview,
        tag: 'optimizely-global-settings',
      })
      const item = outcome.data?.[resolution.typeName]?.items?.[0] ?? outcome.data?._Content?.items?.[0]
      if (outcome.source === 'none') break
      if (outcome.ok && item) {
        return {
          ...normalizeSiteSettings(item, meta),
          candidateItems: [],
          status: {
            source: outcome.source === 'live' ? 'live' : 'cache',
            fetchedAt: outcome.fetchedAt,
            queryLabel: request.label,
            retriedKeys,
          },
        }
      }
    }

    return {
      ...normalizeSiteSettings({}, toMeta(resolution.item, resolution.typeName, resolution.key)),
      candidateItems: [],
      status: {
        source: 'none',
        error:
          requests.length === 0
            ? `Content type ${resolution.typeName} exposes no queryable properties in the Graph schema.`
            : 'The global settings item was found but its properties could not be loaded.',
        retriedKeys,
      },
    }
  }

  // Nothing resolved — surface the error and offer other global-looking items.
  const schema = await loadSchema()
  const candidateItems = await findCandidateItems(schema.index, preview)

  return {
    ...normalizeSiteSettings({}, {
      key: optimizelyConfig.globalConfigId,
      displayName: undefined,
      typeName: undefined,
      types: [],
    }),
    candidateItems,
    status: {
      source: 'none',
      error:
        error ??
        (configStatus.missing.length
          ? `Missing configuration: ${configStatus.missing.join(', ')}.`
          : 'Optimizely Graph could not be reached.'),
      retriedKeys,
    },
  }
}

/**
 * Request-scoped memoised accessor — the layout, the page and any component can
 * call this without triggering duplicate Graph requests during one render.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => getGlobalSettings())
