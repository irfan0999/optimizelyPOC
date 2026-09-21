/**
 * On-disk store for Optimizely Graph responses.
 *
 * The last successful response for a query is kept in `.cms-cache/` and reused
 * when Graph is unreachable (CI, offline dev, sandboxes without egress), so the
 * app still renders instead of throwing. A small key/value state area holds the
 * schema snapshot and the resolved global-settings item.
 *
 * Everything lives in `.cms-cache/` and is git-ignored.
 */

import { createHash } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'

const ROOT = path.join(process.cwd(), '.cms-cache')
const RESULTS_DIR = path.join(ROOT, 'results')

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
  origin: 'server'
  label: string
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
  origin: GraphResult['origin'] = 'server'
): Promise<void> {
  const id = hashRequest(request.query, request.variables)
  const payload: GraphResult<T> = {
    response,
    fetchedAt: new Date().toISOString(),
    origin,
    label: request.label,
  }
  await writeJson(resultFile(id), payload)
}

/** Small key/value state (schema snapshot, resolved content type…). */
export async function readState<T>(name: string): Promise<T | null> {
  return readJson<T>(path.join(ROOT, `${safeId(name)}.json`))
}

export async function writeState(name: string, value: unknown): Promise<void> {
  await writeJson(path.join(ROOT, `${safeId(name)}.json`), value)
}

export async function clearState(name: string): Promise<void> {
  await rm(path.join(ROOT, `${safeId(name)}.json`), { force: true })
}
