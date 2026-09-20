/**
 * Value normalisation for Optimizely Graph payloads.
 *
 * Graph returns a property in whichever shape the CMS editor modelled it in:
 * a plain string, an `XhtmlString` (`{ html, json }`), a `ContentReference`
 * (`{ url: { default } }`), a `LinkItem` (`{ href, title, target }`), a content
 * area (array of blocks)… These helpers turn all of that into the small set of
 * shapes the UI renders, without assuming a fixed content model.
 */

import { fieldOverrides } from './field-map'

export type CmsRawValue = unknown

export interface CmsLink {
  label?: string
  href: string
  target?: string
  /** The original CMS value, kept so the inspector can show it verbatim. */
  source?: CmsRawValue
}

export interface CmsImage {
  url?: string
  alt?: string
  width?: number
  height?: number
  source?: CmsRawValue
}

export interface CmsColumn {
  title?: string
  links: CmsLink[]
}

export interface RawField {
  /** Property name exactly as it comes back from Optimizely Graph. */
  key: string
  /** What the value looks like, so the UI can pick a renderer. */
  kind: 'text' | 'html' | 'link' | 'links' | 'image' | 'boolean' | 'number' | 'list' | 'empty' | 'json'
  /** Short human readable summary. */
  preview: string
  value: CmsRawValue
}

const URL_KEYS = ['href', 'url', 'link', 'value', 'linkUrl', 'urlValue']
const LABEL_KEYS = [
  'label',
  'name',
  'text',
  'title',
  'displayName',
  'linkText',
  'linkLabel',
  'heading',
  'alt',
  'platform',
]

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain text from a scalar, an `XhtmlString` or a rich-text JSON node. */
export function toText(value: CmsRawValue): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(toText).filter(Boolean)
    return parts.length ? parts.join(', ') : undefined
  }
  if (isPlainObject(value)) {
    for (const key of ['html', 'text', 'value', 'displayName', 'label', 'name', 'title']) {
      if (key in value) {
        const text = toText(value[key])
        if (text) return key === 'html' ? stripHtml(text) || undefined : text
      }
    }
  }
  return undefined
}

export function toHtml(value: CmsRawValue): string | undefined {
  if (typeof value === 'string') return value
  if (isPlainObject(value) && typeof value.html === 'string') return value.html
  return undefined
}

function firstUrlString(value: CmsRawValue, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim() || undefined

  if (isPlainObject(value)) {
    for (const key of URL_KEYS) {
      if (key in value) {
        const found = firstUrlString(value[key], depth + 1)
        if (found) return found
      }
    }
    // ContentReference / media: { url: { default: '…' } }, sometimes nested
    // under `_metadata` for referenced items.
    if ('url' in value) {
      const fromUrl = firstUrlString(value.url, depth + 1)
      if (fromUrl) return fromUrl
    }
    if (isPlainObject(value._metadata)) {
      const fromMeta = firstUrlString(value._metadata.url, depth + 1)
      if (fromMeta) return fromMeta
    }
    for (const key of ['default', 'internal', 'hierarchical', 'absolute', 'base']) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrlString(item, depth + 1)
      if (found) return found
    }
  }

  return undefined
}

export function toLink(value: CmsRawValue): CmsLink | undefined {
  if (value === null || value === undefined) return undefined

  if (typeof value === 'string') {
    const href = value.trim()
    return href ? { href, source: value } : undefined
  }

  if (isPlainObject(value)) {
    const href = firstUrlString(value)
    if (!href) return undefined
    const label = LABEL_KEYS.map((key) => toText(value[key])).find(Boolean)
    const target = typeof value.target === 'string' ? value.target : typeof value.linkTarget === 'string' ? value.linkTarget : undefined
    return { href, label, target, source: value }
  }

  return undefined
}

export function toLinks(value: CmsRawValue): CmsLink[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((item) => toLink(item)).filter((link): link is CmsLink => Boolean(link))
  }
  const single = toLink(value)
  return single ? [single] : []
}

export function toImage(value: CmsRawValue): CmsImage | undefined {
  if (!value) return undefined
  const url = firstUrlString(value)
  if (!url) return undefined

  const record = isPlainObject(value) ? value : {}
  const alt = LABEL_KEYS.map((key) => toText(record[key])).find(Boolean)
  const width = typeof record.width === 'number' ? record.width : undefined
  const height = typeof record.height === 'number' ? record.height : undefined

  return { url, alt, width, height, source: value }
}

/**
 * Footer-style column lists: either a content area of blocks
 * (`[{ title, links: [{ label, href }] }]`) or flat link groups.
 */
export function toColumns(value: CmsRawValue): CmsColumn[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]

  return list
    .map((entry) => {
      if (!isPlainObject(entry)) {
        const link = toLink(entry)
        return { links: link ? [link] : [] }
      }

      const title = ['title', 'heading', 'name', 'label', 'displayName'].map((key) => toText(entry[key])).find(Boolean)
      const nested =
        entry.links ?? entry.linkItems ?? entry.items ?? entry.navigation ?? entry.menu ?? entry.children ?? entry.columns
      let links = toLinks(nested)

      // A block that is itself a link (title + href) becomes a one-link column.
      if (!links.length) {
        const self = toLink(entry)
        if (self) links = [{ ...self, label: self.label ?? title }]
      }

      return { title, links }
    })
    .filter((column) => Boolean(column.title) || column.links.length > 0)
}

export function toBoolean(value: CmsRawValue): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^(true|yes|1|on)$/i.test(value.trim())) return true
    if (/^(false|no|0|off)$/i.test(value.trim())) return false
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * Heuristic mapping from CMS property names to the site settings model
 * ------------------------------------------------------------------ */

/**
 * How a settings field is derived from the raw CMS value, keyed by settings
 * field name so explicit overrides in `field-map.ts` get the same treatment.
 */
export const transforms: Record<string, (value: CmsRawValue) => unknown> = {
  siteName: (value) => toText(value),
  tagline: (value) => toText(value),
  logo: (value) => toImage(value),
  favicon: (value) => toImage(value),
  navigation: (value) => toLinks(value),
  footerColumns: (value) => toColumns(value),
  socialLinks: (value) => toLinks(value),
  legalLinks: (value) => toLinks(value),
  copyright: (value) => toText(value),
  footerText: (value) => toText(value),
  contactEmail: (value) => toText(value),
  contactPhone: (value) => toText(value),
  contactAddress: (value) => toText(value),
  contactHours: (value) => toText(value),
  ctaText: (value) => toText(value),
  ctaHref: (value) => toLink(value)?.href ?? toText(value),
  announcementText: (value) => toText(value),
  announcementHref: (value) => toLink(value)?.href ?? toText(value),
  announcementEnabled: (value) => toBoolean(value) ?? Boolean(toText(value)),
}

export function normalizeTransform(target: string): (value: CmsRawValue) => unknown {
  return transforms[target] ?? ((value: CmsRawValue) => value)
}

export interface FieldRule {
  target: string
  test: RegExp
}

/**
 * Ordered rules — the first rule whose pattern matches a CMS property name wins.
 * Anything not matched is still available under `settings.raw` and rendered by
 * the CMS inspector.
 */
export const fieldRules: FieldRule[] = [
  { target: 'logo', test: /logo|brand.?mark|brand.?image/i },
  { target: 'favicon', test: /favicon|touch.?icon/i },
  { target: 'siteName', test: /^(site.?name|brand.?name|company.?name|organisation|organization|website.?name)$/i },
  { target: 'siteName', test: /^(title|name)$/i },
  { target: 'tagline', test: /tagline|slogan|strap.?line|site.?description|short.?description|meta.?description/i },
  {
    target: 'announcementText',
    test: /(announcement|banner|alert|notice|notification).*(text|message|title)|^(announcement|banner|alert|message)$/i,
  },
  { target: 'announcementHref', test: /(announcement|banner|alert|notice).*(href|url|link)/i },
  { target: 'announcementEnabled', test: /(announcement|banner|alert|notice).*(enabled|active|visible|show)/i },
  { target: 'navigation', test: /(nav|menu)/i },
  { target: 'footerColumns', test: /footer.*(columns?|sections?|groups?|menus?|links?)/i },
  { target: 'footerText', test: /footer.*(text|note|copy|copyright|disclaimer)/i },
  { target: 'copyright', test: /copyright|©|all.?rights/i },
  { target: 'socialLinks', test: /social|follow.?us/i },
  { target: 'legalLinks', test: /(legal|terms|privacy|policy|cookie).*(links?|items?)?/i },
  { target: 'contactEmail', test: /(contact|support|info|help|service).*e.?mail|^e.?mail$/i },
  { target: 'contactPhone', test: /(contact|support|help|service).*(phone|tel|number)|^(phone|telephone|phoneNumber|contactNumber)$/i },
  { target: 'contactAddress', test: /address/i },
  { target: 'contactHours', test: /(opening|business|office|contact|support).*hours|^hours$/i },
  { target: 'ctaText', test: /(cta|call.?to.?action|button|primary.?action).*(text|label|caption|title)/i },
  { target: 'ctaHref', test: /(cta|call.?to.?action|button|primary.?action).*(href|url|link|target)/i },
  { target: 'ctaText', test: /^cta$/i },
]

export interface MappedField {
  /** CMS property name. */
  key: string
  /** Settings field the property was mapped to. */
  target: string
  value: CmsRawValue
  transform: (value: CmsRawValue) => unknown
}

/** Apply the explicit overrides first, then the heuristic rules. */
export function mapFields(raw: Record<string, unknown>): MappedField[] {
  const mapped: MappedField[] = []
  const claimed = new Set<string>()

  for (const [key, target] of Object.entries(fieldOverrides)) {
    if (key in raw) {
      mapped.push({ key, target, value: raw[key], transform: normalizeTransform(target) })
      claimed.add(key)
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (claimed.has(key)) continue
    const rule = fieldRules.find((candidate) => candidate.test.test(key))
    if (!rule) continue
    mapped.push({ key, target: rule.target, value, transform: normalizeTransform(rule.target) })
  }

  return mapped
}

/** Describe a raw Graph payload for the CMS inspector UI. */
export function describeRawFields(raw: Record<string, unknown>): RawField[] {
  return Object.entries(raw)
    .filter(([key]) => key !== '_metadata' && key !== '__typename')
    .map(([key, value]) => {
      const html = toHtml(value)
      const links = Array.isArray(value) ? toLinks(value) : []
      const columns = toColumns(value)
      const link = toLink(value)
      const image = toImage(value)
      const arrayValue = Array.isArray(value) ? value : undefined

      let kind: RawField['kind'] = 'json'
      if (value === null || value === undefined) kind = 'empty'
      else if (typeof value === 'boolean') kind = 'boolean'
      else if (typeof value === 'number') kind = 'number'
      else if (links.length > 1) kind = 'links'
      else if (arrayValue) kind = 'list'
      else if (html) kind = 'html'
      else if (typeof value === 'string') kind = 'text'
      else if (link && isPlainObject(value) && Object.keys(value).some((k) => /url|href|link/i.test(k))) kind = 'link'
      else if (image && isPlainObject(value) && Object.keys(value).some((k) => /url|image|media/i.test(k))) kind = 'image'

      let preview = ''
      switch (kind) {
        case 'links':
          preview = links.map((item) => item.label ?? item.href).join(' · ')
          break
        case 'list':
          preview = (columns.length ? columns.map((column) => column.title ?? `${column.links.length} links`) : arrayValue!.map((item) => toText(item) ?? JSON.stringify(item)))
            .join(' · ')
            .slice(0, 180)
          break
        case 'link':
        case 'image':
          preview = link?.href ?? image?.url ?? ''
          break
        case 'html':
          preview = stripHtml(html!).slice(0, 180)
          break
        case 'empty':
          preview = '(not set)'
          break
        case 'boolean':
        case 'number':
          preview = String(value)
          break
        default:
          preview = (toText(value) ?? JSON.stringify(value) ?? '').slice(0, 180)
      }

      return { key, kind, preview, value }
    })
}
