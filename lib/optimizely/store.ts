/**
 * On-disk store for Optimizely Graph responses.
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
 * Everything lives in `.cms-cache/` and is git-ignored.
 */

import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'

const ROOT = path.join(process.cwd(), '.cms-cache')
const RESULTS_DIR = path.join(ROOT, 'results')
const PENDING_DIR = path.join(ROOT, 'pending')

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

const resultFile = (id: string) => path.join(RESULTS_DIR, `${safeId(id)}.json`)
const pendingFile = (id: string) => path.join(PENDING_DIR, `${safeId(id)}.json`)

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

/** Read a cached Graph response for the given query, if one was captured before. */
export async function readResult<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphResult<T> | null> {
  return readJson<GraphResult<T>>(resultFile(hashRequest(query, variables)))
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
  await writeJson(resultFile(id), payload)
  // A captured result means the request is no longer pending.
  await rm(pendingFile(id), { force: true })
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
  await writeJson(pendingFile(id), pending)
}

/** Look up a single queued request (used by the bridge to save its response). */
export async function readPending(id: string): Promise<PendingRequest | null> {
  return readJson<PendingRequest>(pendingFile(safeId(id)))
}

export async function clearPending(id: string): Promise<void> {
  await rm(pendingFile(safeId(id)), { force: true })
}

export async function listPending(): Promise<PendingRequest[]> {
  const files = await readdir(PENDING_DIR).catch(() => [] as string[])
  const entries = await Promise.all(
    files.filter((file) => file.endsWith('.json')).map((file) => readJson<PendingRequest>(path.join(PENDING_DIR, file)))
  )
  return entries.filter((entry): entry is PendingRequest => Boolean(entry?.query))
}

/** Small key/value state (schema snapshot, resolved content type, chosen strategy…). */
export async function readState<T>(name: string): Promise<T | null> {
  return readJson<T>(path.join(ROOT, `${safeId(name)}.json`))
}

export async function writeState(name: string, value: unknown): Promise<void> {
  await writeJson(path.join(ROOT, `${safeId(name)}.json`), value)
}

export async function clearState(name: string): Promise<void> {
  await rm(path.join(ROOT, `${safeId(name)}.json`), { force: true })
}

export const storePath = ROOT

/** Wipe every captured response (used by the CMS bridge "reset" action). */
export async function clearResults(): Promise<void> {
  await rm(RESULTS_DIR, { recursive: true, force: true })
  await rm(PENDING_DIR, { recursive: true, force: true })
  await rm(path.join(ROOT, 'schema.json'), { force: true })
  await rm(path.join(ROOT, 'global-config-resolution.json'), { force: true })
}
