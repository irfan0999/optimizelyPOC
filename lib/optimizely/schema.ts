/**
 * Optimizely Graph schema introspection + query generation.
 *
 * The CMS content model is the source of truth: instead of hard-coding a
 * GraphQL selection set (which breaks every time an editor adds a property to
 * the global settings type), the app introspects the schema, discovers which
 * content type the configured GUID belongs to, and generates the selection set
 * for it. New properties added in the CMS appear automatically.
 */

import { getIntrospectionQuery } from 'graphql'
import { GraphRequest, hashRequest, readState, writeState } from './store'
import { runQuery } from './client'

export interface GraphTypeRef {
  kind: string
  name: string | null
  ofType?: GraphTypeRef | null
}

export interface GraphField {
  name: string
  isDeprecated?: boolean
  args?: { name: string; type: GraphTypeRef }[]
  type: GraphTypeRef
}

export interface GraphType {
  kind: string
  name: string
  fields?: GraphField[] | null
  enumValues?: { name: string }[] | null
  possibleTypes?: { name: string }[] | null
}

interface IntrospectionPayload {
  __schema: { types: GraphType[] }
}

export interface SchemaIndex {
  types: Map<string, GraphType>
  capturedAt: string
}

const SCHEMA_STATE = 'schema'

/** System fields that make no sense in a generated selection set — some are
 * outright rejected by Optimizely Graph (e.g. `_json` is only valid inside the
 * `item` field of an autocomplete/query result, not on a typed content query). */
const SKIPPED_FIELDS = new Set([
  '_children',
  '_link',
  '_deleted',
  '_fulltext',
  '_modified',
  '_score',
  '_source',
  '_id',
  '_track',
  '_itemMetadata',
  '_json',
  '_routing',
])

/** System prefixes that make no sense in a generated selection set. */
const SKIPPED_PREFIXES = ['_link', '_score', '_sortOrder', '_modified', '_fulltext']

export function introspectionRequest(): GraphRequest {
  const query = getIntrospectionQuery({ descriptions: false, schemaDescription: false })
  return {
    id: hashRequest(query),
    label: 'schema introspection',
    query,
    variables: {},
  }
}

/** Introspection responses include the whole schema — only keep what we need. */
export function buildIndex(payload: IntrospectionPayload, capturedAt = new Date().toISOString()): SchemaIndex {
  const types = new Map<string, GraphType>()
  for (const type of payload?.__schema?.types ?? []) {
    if (type?.name) types.set(type.name, type)
  }
  return { types, capturedAt }
}

export async function loadSchema(): Promise<{
  index: SchemaIndex | null
  source: 'live' | 'cache' | 'none'
  error?: string
  queued?: boolean
}> {
  const stored = await readState<IntrospectionPayload>(SCHEMA_STATE)
  const request = introspectionRequest()

  // A live introspection refreshes the snapshot; otherwise reuse the snapshot.
  const outcome = await runQuery<IntrospectionPayload>(request, { queue: true })
  if (outcome.data?.__schema?.types) {
    // Live introspection comes straight from Graph; a captured one comes from the
    // browser bridge. Either way it is a usable schema snapshot.
    const index = buildIndex(outcome.data)
    if (outcome.source === 'live') {
      await writeState(SCHEMA_STATE, outcome.data)
    }
    return { index, source: outcome.source === 'live' ? 'live' : 'cache' }
  }

  if (stored?.__schema?.types) {
    return { index: buildIndex(stored), source: 'cache' }
  }

  return {
    index: null,
    source: 'none',
    error: outcome.error ?? 'Optimizely Graph schema is unavailable.',
    queued: outcome.queued,
  }
}

function unwrap(type: GraphTypeRef | undefined | null): GraphTypeRef | null {
  let current = type ?? null
  while (current && (current.kind === 'NON_NULL' || current.kind === 'LIST')) {
    current = current.ofType ?? null
  }
  return current
}

export function namedTypeName(type: GraphTypeRef | undefined | null): string | null {
  return unwrap(type)?.name ?? null
}

export function isLeafField(field: GraphField): boolean {
  const named = unwrap(field.type)
  return named?.kind === 'SCALAR' || named?.kind === 'ENUM'
}

function hasRequiredArgs(field: GraphField): boolean {
  return (field.args ?? []).some((arg) => arg.type?.kind === 'NON_NULL')
}

/**
 * Recursively build a GraphQL selection set for a content type.
 *
 * Interfaces and unions are skipped (they need inline fragments and hand-written
 * fragments), everything else — scalars, enums, nested content references,
 * content areas, links — is included.
 */
export function buildSelectionSet(
  index: SchemaIndex,
  typeName: string,
  { maxDepth = 3, maxFieldsPerLevel = 60 }: { maxDepth?: number; maxFieldsPerLevel?: number } = {}
): string | null {
  const root = index.types.get(typeName)
  if (!root?.fields?.length) return null

  const walk = (name: string, depth: number, path: string[]): string | null => {
    const type = index.types.get(name)
    if (!type?.fields?.length) return null

    const lines: string[] = []
    let count = 0

    for (const field of type.fields) {
      if (count >= maxFieldsPerLevel) break
      if (field.isDeprecated) continue
      if (hasRequiredArgs(field)) continue
      const fieldName = field.name
      if (fieldName.startsWith('__')) continue
      if (SKIPPED_FIELDS.has(fieldName)) continue
      if (SKIPPED_PREFIXES.some((prefix) => fieldName.startsWith(prefix))) continue

      const named = unwrap(field.type)
      if (!named) continue

      if (named.kind === 'SCALAR' || named.kind === 'ENUM') {
        lines.push(fieldName)
        count += 1
        continue
      }

      if (named.kind !== 'OBJECT' || !named.name) continue
      if (depth <= 0) continue
      if (path.includes(named.name)) continue

      const nested = walk(named.name, depth - 1, [...path, named.name])
      if (!nested) continue
      lines.push(`${fieldName} { ${nested} }`)
      count += 1
    }

    if (!lines.length) return null
    return ['__typename', ...lines].join(' ')
  }

  return walk(typeName, maxDepth, [typeName])
}

/** From `_metadata.types` pick the concrete content type (e.g. `GlobalConfigDefault`). */
export function pickConcreteType(types: string[] | undefined, index?: SchemaIndex | null, hint = /global|setting|config/i): string | null {
  const candidates = (types ?? []).filter((name) => name && !name.startsWith('_'))
  if (!candidates.length) return null

  const known = candidates.filter((name) => (index ? index.types.get(name)?.kind === 'OBJECT' : true))
  const pool = known.length ? known : candidates

  const hinted = pool.filter((name) => hint.test(name))
  const best = (hinted.length ? hinted : pool).sort((a, b) => a.length - b.length)[0]
  return best ?? null
}

/** Content types that look like a global settings container (used as a fallback). */
export function findGlobalSettingsTypes(index: SchemaIndex): string[] {
  const names: string[] = []
  for (const [name, type] of index.types) {
    if (type.kind !== 'OBJECT') continue
    if (name.startsWith('_')) continue
    if (/(Connection|FilterInput|Input|OrderBy|Facet|Result|WhereInput)$/i.test(name)) continue
    if (!/(global.*(config|setting)|site.*setting|(config|setting).*global)/i.test(name)) continue
    names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

export interface ContentLookupItem {
  __typename?: string
  _metadata?: {
    key?: string
    displayName?: string
    locale?: string
    types?: string[]
    status?: string
    lastModified?: string
    published?: string
    version?: string
    url?: { default?: string; base?: string; hierarchical?: string; internal?: string; graph?: string; type?: string }
  }
  // CMS 12 (Graph v1) shape
  Name?: string
  Url?: string
  ContentLink?: { GuidValue?: string; Id?: number; Url?: string }
  Language?: { Name?: string; DisplayName?: string }
  Status?: string
  ContentType?: string[]
}

export interface ContentLookupPayload {
  _Content?: { total?: number; items?: ContentLookupItem[] }
  Content?: { total?: number; items?: ContentLookupItem[] }
}

const METADATA_RICH = `__typename _metadata { key displayName locale types status url { default base hierarchical internal graph type } lastModified published version }`
const METADATA_BASIC = `__typename _metadata { key displayName types url { default base } }`
const METADATA_MINIMAL = `__typename _metadata { key }`
const LEGACY_SELECTION = `__typename Name Url ContentLink { GuidValue Id Url } Language { Name DisplayName Link } Status StartPublish Changed ContentType`

function lookup(label: string, selection: string, variable: string, legacy = false): GraphRequest {
  const query = legacy
    ? `query LegacyContentLookup($id: String!) {
  Content(where: { ContentLink: { GuidValue: { eq: $id } } }, limit: 1) {
    total
    items { ${selection} }
  }
}`
    : `query ContentLookup($id: String!) {
  _Content(where: { _metadata: { key: { eq: $id } } }, limit: 1) {
    total
    items { ${selection} }
  }
}`
  return { id: hashRequest(query, { id: variable }), label, query, variables: { id: variable } }
}

export function discoveryRequests(id: string, { legacy = false }: { legacy?: boolean } = {}): GraphRequest[] {
  if (legacy) {
    return [lookup('global settings lookup (CMS 12 / Graph v1)', LEGACY_SELECTION, id, true)]
  }
  return [
    lookup('global settings lookup', METADATA_RICH, id),
    lookup('global settings lookup (reduced metadata)', METADATA_BASIC, id),
    lookup('global settings lookup (key only)', METADATA_MINIMAL, id),
  ]
}

/** Minimal query used when the GUID could not be found: list items of a type. */
export function itemsByTypeRequest(typeName: string, limit = 5): GraphRequest {
  const query = `query ContentTypeItems($limit: Int) {
  ${typeName}(limit: $limit) {
    total
    items { __typename _metadata { key displayName types url { default base } lastModified status } }
  }
}`
  return {
    id: hashRequest(query, { limit }),
    label: `search items of type ${typeName}`,
    query,
    variables: { limit },
  }
}

/** Full content query for a discovered type, in two shape variants. */
export function contentRequests(
  typeName: string,
  id: string,
  index: SchemaIndex
): GraphRequest[] {
  const selection = buildSelectionSet(index, typeName)
  if (!selection) return []

  const typeQuery = `query GlobalConfig($id: String!) {
  ${typeName}(where: { _metadata: { key: { eq: $id } } }, limit: 1) {
    total
    items { ${selection} }
  }
}`

  const genericQuery = `query GlobalConfigGeneric($id: String!) {
  _Content(where: { _metadata: { key: { eq: $id } } }, limit: 1) {
    total
    items {
      ... on ${typeName} { ${selection} }
    }
  }
}`

  return [
    {
      id: hashRequest(typeQuery, { id }),
      label: `global settings content (${typeName})`,
      query: typeQuery,
      variables: { id },
    },
    {
      id: hashRequest(genericQuery, { id }),
      label: `global settings content via _Content (${typeName})`,
      query: genericQuery,
      variables: { id },
    },
  ]
}
