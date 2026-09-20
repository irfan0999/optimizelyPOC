/**
 * Store for Optimizely Graph responses.
 *
 * Two reasons this exists:
 *
 * 1. **Resilience** — the last successful response for a query is reused when
 *    Graph is unreachable (CI, offline dev, sandboxes without egress), so the
 *    app still renders instead of throwing.
 * 2. **Browser bridge** — when the runtime performing the request has no
 *    network access to `cg.optimizely.com`, the failed queries are queued here
 *    and replayed from a browser that *can* reach Graph (see `/cms-bridge`).
 *
 * Where the data lives (first writable location wins):
 *
 *   1. `OPTIMIZELY_CACHE_DIR` when set
 *   2. `<project>/.cms-cache/` (git-ignored) — the normal development location
 *   3. `<os tmpdir>/optimizely-cms-cache/` — hosts whose application directory
 *      is read-only (Vercel, Netlify, AWS Lambda, hardened containers…)
 *   4. process memory — nothing on disk is writable at all
 *
 * The store is a cache, never the source of truth, so **no operation in this
 * module throws**: a failed write falls back to memory and the page keeps
 * rendering. Before this, a read-only file system (`EROFS` / `EACCES` on
 * `mkdir .cms-cache`) took the whole site down with a server-side exception.
 */

import { createHash } from 'crypto'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import os from 'os'
import path from 'path'
import { optimizelyConfig } from './config'

export interface GraphRequest {
  id: string
  label: string
  query: string
  variables: Record<string, unknown>
}

export interface GraphResult<T = unknown> {
  /** Graph response payload (`data` + optional `errors`). */
  response: { data?: T; errors?: unknown[] } & Record<string, unknown>
  fetchedAt: string
  /** Where the payload came from when it was captured. */
  origin: 'server' | 'browser-bridge'
  label: string
}

export interface PendingRequest extends GraphRequest {
  error: string
  recordedAt: string
}

export type StoreBackend = 'disk' | 'memory'

export interface StoreInfo {
  /** `disk` when a writable directory was found, `memory` otherwise. */
  backend: StoreBackend
  /** Directory in use (also reported for `memory`, as the location that was tried). */
  directory: string
  /** Why the disk could not be used, when it could not. */
  reason?: string
}

// ─── Locations ───────────────────────────────────────────────────────────────

const RESULTS = 'results'
const PENDING = 'pending'

const DEFAULT_ROOT = path.join(process.cwd(), '.cms-cache')

function candidateRoots(): string[] {
  const configured = optimizelyConfig.cacheDir
  const roots = [
    configured ? path.resolve(configured) : null,
    DEFAULT_ROOT,
    path.join(os.tmpdir(), 'optimizely-cms-cache'),
  ]
  return [...new Set(roots.filter((root): root is string => Boolean(root)))]
}

/**
 * Module-level state is kept on `globalThis` so it survives hot reloads in
 * development and is shared by every copy of this module in a server bundle.
 */
interface StoreState {
  rootPromise: Promise<StoreInfo> | null
  memory: Map<string, unknown>
  warned: boolean
}

const STATE_KEY = Symbol.for('optimizely.cms-store')
const state: StoreState = ((globalThis as Record<symbol, StoreState | undefined>)[STATE_KEY] ??= {
  rootPromise: null,
  memory: new Map<string, unknown>(),
  warned: false,
})

function warnOnce(message: string): void {
  if (state.warned) return
  state.warned = true
  console.warn(`[optimizely] ${message}`)
}

async function isWritableDirectory(dir: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
    await access(dir, fsConstants.W_OK)
    const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`)
    await writeFile(probe, '', 'utf8')
    await rm(probe, { force: true })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    return code ? `${code}: ${(error as Error).message}` : String(error)
  }
}

/** Pick (once per process) the first location we can actually write to. */
function resolveStore(): Promise<StoreInfo> {
  if (!state.rootPromise) {
    state.rootPromise = (async () => {
      const failures: string[] = []
      for (const dir of candidateRoots()) {
        const failure = await isWritableDirectory(dir)
        if (!failure) {
          if (dir !== DEFAULT_ROOT && !optimizelyConfig.cacheDir) {
            warnOnce(
              `${DEFAULT_ROOT} is not writable (${failures[0] ?? 'unknown reason'}) — caching Optimizely Graph responses in ${dir} instead. Set OPTIMIZELY_CACHE_DIR to choose a location.`
            )
          }
          return { backend: 'disk', directory: dir }
        }
        failures.push(`${dir} (${failure})`)
      }

      const reason = failures.join('; ')
      warnOnce(
        `No writable directory for the Optimizely Graph cache — keeping responses in memory for this process only. Tried: ${reason}`
      )
      return { backend: 'memory', directory: DEFAULT_ROOT, reason }
    })()
  }
  return state.rootPromise
}

/** Which backend/directory the store is using — surfaced in the UI for diagnostics. */
export async function getStoreInfo(): Promise<StoreInfo> {
  return resolveStore()
}

/** @deprecated The directory is resolved at runtime; use `getStoreInfo()`. */
export const storePath = DEFAULT_ROOT

// ─── Low-level, never-throwing JSON persistence ──────────────────────────────

/** Keys are store-relative paths such as `results/<id>.json`, independent of the backend. */
async function readJson<T>(key: string): Promise<T | null> {
  if (state.memory.has(key)) {
    return state.memory.get(key) as T
  }
  const store = await resolveStore()
  try {
    return JSON.parse(await readFile(path.join(store.directory, key), 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const store = await resolveStore()
  if (store.backend === 'disk') {
    try {
      const file = path.join(store.directory, key)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
      state.memory.delete(key)
      return
    } catch (error) {
      warnOnce(
        `Could not write ${key} to ${store.directory} (${(error as Error).message}) — keeping it in memory instead.`
      )
    }
  }
  state.memory.set(key, value)
}

async function removeJson(key: string): Promise<void> {
  state.memory.delete(key)
  const store = await resolveStore()
  try {
    await rm(path.join(store.directory, key), { force: true })
  } catch {
    // Nothing to do — the store is a cache.
  }
}

async function removeDirectory(name: string): Promise<void> {
  const prefix = `${name}/`
  for (const key of [...state.memory.keys()]) {
    if (key.startsWith(prefix)) state.memory.delete(key)
  }
  const store = await resolveStore()
  try {
    await rm(path.join(store.directory, name), { recursive: true, force: true })
  } catch {
    // Nothing to do — the store is a cache.
  }
}

async function listKeys(name: string): Promise<string[]> {
  const prefix = `${name}/`
  const keys = new Set<string>()
  for (const key of state.memory.keys()) {
    if (key.startsWith(prefix) && key.endsWith('.json')) keys.add(key)
  }
  const store = await resolveStore()
  const files = await readdir(path.join(store.directory, name)).catch(() => [] as string[])
  for (const file of files) {
    if (file.endsWith('.json')) keys.add(`${prefix}${file}`)
  }
  return [...keys]
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function hashRequest(query: string, variables?: Record<string, unknown>): string {
  return createHash('sha1')
    .update(query)
    .update('|')
    .update(JSON.stringify(variables ?? {}))
    .digest('hex')
    .slice(0, 20)
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

const resultKey = (id: string) => `${RESULTS}/${safeId(id)}.json`
const pendingKey = (id: string) => `${PENDING}/${safeId(id)}.json`
const stateKey = (name: string) => `${safeId(name)}.json`

/** Read a cached Graph response for the given query, if one was captured before. */
export async function readResult<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphResult<T> | null> {
  return readJson<GraphResult<T>>(resultKey(hashRequest(query, variables)))
}

export async function writeResult<T = unknown>(
  request: GraphRequest,
  response: GraphResult<T>['response'],
  origin: GraphResult['origin']
): Promise<void> {
  const id = hashRequest(request.query, request.variables)
  const payload: GraphResult<T> = {
    response,
    fetchedAt: new Date().toISOString(),
    origin,
    label: request.label,
  }
  await writeJson(resultKey(id), payload)
  // A captured result means the request is no longer pending.
  await removeJson(pendingKey(id))
}

/** Queue a query that could not be executed here so the browser bridge can replay it. */
export async function recordPending(request: GraphRequest, error: string): Promise<void> {
  const id = hashRequest(request.query, request.variables)
  const pending: PendingRequest = {
    ...request,
    id,
    error,
    recordedAt: new Date().toISOString(),
  }
  await writeJson(pendingKey(id), pending)
}

/** Look up a single queued request (used by the bridge to save its response). */
export async function readPending(id: string): Promise<PendingRequest | null> {
  return readJson<PendingRequest>(pendingKey(id))
}

export async function clearPending(id: string): Promise<void> {
  await removeJson(pendingKey(id))
}

export async function listPending(): Promise<PendingRequest[]> {
  const keys = await listKeys(PENDING)
  const entries = await Promise.all(keys.map((key) => readJson<PendingRequest>(key)))
  return entries.filter((entry): entry is PendingRequest => Boolean(entry?.query))
}

/** Small key/value state (schema snapshot, resolved content type, chosen strategy…). */
export async function readState<T>(name: string): Promise<T | null> {
  return readJson<T>(stateKey(name))
}

export async function writeState(name: string, value: unknown): Promise<void> {
  await writeJson(stateKey(name), value)
}

export async function clearState(name: string): Promise<void> {
  await removeJson(stateKey(name))
}

/** Wipe every captured response (used by the CMS bridge "reset" action). */
export async function clearResults(): Promise<void> {
  await removeDirectory(RESULTS)
  await removeDirectory(PENDING)
  await removeJson(stateKey('schema'))
  await removeJson(stateKey('global-config-resolution'))
}
