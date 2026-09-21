/**
 * One-off diagnostic: does the configured global settings item have content
 * properties (content references, link lists, …) in Optimizely Graph?
 *
 * Usage: node scripts/check-global-settings.js
 * Reads OPTIMIZELY_API_URL / OPTIMIZELY_SINGLE_KEY / OPTIMIZELY_GLOBAL_CONFIG_ID
 * from .env.local (same variables the app uses). Never prints the key.
 */
const fs = require('fs')
const path = require('path')

function loadEnv() {
  const file = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    value = value.replace(/^["']|["']$/g, '')
    if (value.trim()) env[match[1]] = value.trim()
  }
  return env
}

const env = loadEnv()
const endpoint = (env.OPTIMIZELY_API_URL || 'https://cg.optimizely.com/content/v2')
const key = env.OPTIMIZELY_SINGLE_KEY
const contentId = env.OPTIMIZELY_GLOBAL_CONFIG_ID || 'b52fa355a42742abae04990fd195101a'

if (!key) {
  console.error('OPTIMIZELY_SINGLE_KEY is not set in .env.local — cannot query live Graph.')
  process.exit(1)
}

const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}auth=${encodeURIComponent(key)}`

async function gql(query, variables = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`)
  return payload
}

function unwrap(type) {
  let cur = type
  while (cur && (cur.kind === 'NON_NULL' || cur.kind === 'LIST')) cur = cur.ofType
  return cur
}

const SYSTEM_FIELDS = new Set([
  '_children', '_link', '_deleted', '_fulltext', '_modified', '_score',
  '_source', '_id', '_track', '_itemMetadata', '_json', '_routing',
])
const SKIPPED_PREFIXES = ['_link', '_score', '_sortOrder', '_modified', '_fulltext']

async function main() {
  // 1. Live introspection
  const intro = await gql(`
    query Introspect {
      __schema { types {
        kind name
        fields { name type { kind name ofType { kind name ofType { kind name } } } args { name type { kind name ofType { kind name } } } }
      } }
    }
  `)
  if (intro.errors?.length) throw new Error('Introspection errors: ' + intro.errors.map(e => e.message).join('; '))
  const types = new Map(intro.data.__schema.types.map(t => [t.name, t]))

  const gs = types.get('GlobalSettings')
  console.log('=== GlobalSettings type in LIVE schema ===')
  if (!gs || !gs.fields?.length) {
    console.log('NOT FOUND or has no fields. The Graph schema sync may be stale — trigger a sync in the CMS (Admin > Optimizely Graph) and retry.')
    return
  }
  const contentFields = gs.fields.filter(f => !f.name.startsWith('__') && !SYSTEM_FIELDS.has(f.name) && !SKIPPED_PREFIXES.some(p => f.name.startsWith(p)))
  console.log(`Total fields: ${gs.fields.length}, content properties: ${contentFields.length}`)
  for (const f of contentFields) {
    const named = unwrap(f.type)
    const kind = named ? named.kind : '?'
    const name = named ? named.name : '?'
    const req = (f.args || []).some(a => a.type?.kind === 'NON_NULL')
    console.log(`  ${f.name} : ${name} (${kind})${req ? ' [required args - skipped]' : ''}`)
  }

  // 2. Build a selection set: scalars/enums directly, objects recursed 2 levels.
  const scalars = new Set(['SCALAR', 'ENUM'])
  function selection(typeName, depth, seen) {
    const t = types.get(typeName)
    if (!t?.fields?.length) return null
    const parts = []
    for (const f of t.fields) {
      if (f.name.startsWith('__')) continue
      if (SYSTEM_FIELDS.has(f.name)) continue
      if (SKIPPED_PREFIXES.some(p => f.name.startsWith(p))) continue
      if ((f.args || []).some(a => a.type?.kind === 'NON_NULL')) continue
      const named = unwrap(f.type)
      if (!named) continue
      if (scalars.has(named.kind)) { parts.push(f.name); continue }
      if (named.kind !== 'OBJECT' || depth <= 0 || seen.has(named.name)) continue
      const nested = selection(named.name, depth - 1, new Set([...seen, named.name]))
      if (nested) parts.push(`${f.name} { ${nested} }`)
    }
    return parts.length ? parts.join(' ') : null
  }

  const sel = selection('GlobalSettings', 2, new Set(['GlobalSettings']))
  if (!sel) { console.log('\nNo selectable content properties — the type only exposes system fields in Graph.'); return }

  // 3. Query the item by key (both dashed and compact forms)
  const compact = contentId.replace(/-/g, '')
  const keys = [...new Set([compact, contentId])]

  for (const id of keys) {
    const result = await gql(`
      query CheckGlobalSettings($id: String!) {
        GlobalSettings(where: { _metadata: { key: { eq: $id } } }, limit: 1) {
          total
          items { _metadata { key displayName types status version } ${sel} }
        }
      }
    `, { id })
    if (result.errors?.length) {
      console.log(`\nQuery with key "${id}" errored:`, result.errors.map(e => e.message).join(' | ').slice(0, 400))
      continue
    }
    const conn = result.data?.GlobalSettings
    console.log(`\n=== GlobalSettings query (key: ${id}) ===`)
    console.log(`total: ${conn?.total}`)
    const item = conn?.items?.[0]
    if (!item) { console.log('No item returned for this key.'); continue }

    console.log('displayName:', item._metadata?.displayName, '| types:', (item._metadata?.types || []).join(', '), '| version:', item._metadata?.version)
    console.log('\n--- Property values (content references marked with ->) ---')
    for (const [k, v] of Object.entries(item)) {
      if (k === '_metadata') continue
      const isObj = v !== null && typeof v === 'object'
      const summary = isObj ? JSON.stringify(v) : String(v)
      console.log(`  ${k}${isObj ? ' ->' : ':'} ${summary.length > 200 ? summary.slice(0, 200) + '…' : summary}`)
    }
    return
  }
}

main().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
