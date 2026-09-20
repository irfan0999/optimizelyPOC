'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface PendingQuery {
  id: string
  label: string
  query: string
  variables: Record<string, unknown>
  error: string
  recordedAt: string
}

interface SettingsSnapshot {
  source: string
  error: string | null
  typeName: string | null
  displayName: string | null
  key: string | null
  propertyCount: number
}

interface BridgeState {
  endpoint: string
  serverKey: string | null
  hasServerKey: boolean
  pending: PendingQuery[]
  settings: SettingsSnapshot
}

const KEY_STORAGE = 'optimizely-bridge-key'
const MAX_ITERATIONS = 12

/**
 * Development helper: replays the Optimizely Graph queries this runtime could
 * not execute, from the browser (which normally *does* have access to
 * `cg.optimizely.com`), and stores the responses locally so the site renders
 * with real CMS content.
 */
export default function CmsBridge({ endpoint, serverKey }: { endpoint: string; serverKey: string | null }) {
  const [log, setLog] = useState<string[]>([])
  const [state, setState] = useState<BridgeState | null>(null)
  const [apiKey, setApiKey] = useState(serverKey ?? '')
  const [running, setRunning] = useState(false)
  const [pasted, setPasted] = useState<Record<string, string>>({})
  const startedRef = useRef(false)

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`].slice(-80))
  }, [])

  const call = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch('/api/cms-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      })
      return (await response.json()) as BridgeState & { ok?: boolean; error?: string; captured?: { label: string } }
    },
    []
  )

  const refresh = useCallback(async () => {
    const response = await fetch('/api/cms-bridge', { cache: 'no-store' })
    const data = (await response.json()) as BridgeState
    setState(data)
    return data
  }, [])

  /** Run one pending query from the browser and hand the response to the server. */
  const runQuery = useCallback(
    async (entry: PendingQuery, key: string) => {
      const separator = endpoint.includes('?') ? '&' : '?'
      const response = await fetch(`${endpoint}${separator}auth=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: entry.query, variables: entry.variables ?? {} }),
      })

      const payload = (await response.json()) as { errors?: { message?: string }[]; data?: unknown }
      const errors = payload?.errors?.map((error) => error?.message ?? 'error') ?? []
      append(errors.length ? `✗ ${entry.label} — ${errors.join('; ').slice(0, 220)}` : `✓ ${entry.label}`)

      const result = await call({ action: 'capture', id: entry.id, response: payload })
      if (result?.pending) setState(result)
      return result
    },
    [append, call, endpoint]
  )

  /** Advance the plan until nothing is queued (each step reveals the next query). */
  const runAll = useCallback(
    async (key: string) => {
      if (!key) {
        append('Add an API key (or set OPTIMIZELY_SINGLE_KEY) to capture content.')
        return
      }

      setRunning(true)
      let iteration = 0
      try {
        let current = await refresh()
        while (iteration < MAX_ITERATIONS) {
          const pending = current?.pending ?? []
          if (!pending.length) break
          iteration += 1
          for (const entry of pending) {
            await runQuery(entry, key)
          }
          current = await refresh()
        }
        append(
          current?.settings?.source && current.settings.source !== 'sample'
            ? `Done — global settings resolved from ${current.settings.typeName} (${current.settings.propertyCount} properties).`
            : 'Done — nothing left in the queue.'
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        append(`✗ Browser could not reach Optimizely Graph: ${message}`)
        append('Use the manual capture below if this environment blocks cross-origin requests.')
      } finally {
        setRunning(false)
      }
    },
    [append, refresh, runQuery]
  )

  // Pick up a key the developer typed earlier and show the current queue once.
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY_STORAGE)
    if (stored) {
      setApiKey((current) => current || stored)
      return
    }
    void (async () => {
      const data = await refresh()
      append(`${data.pending.length} query/queries queued for capture.`)
    })()
  }, [append, refresh])

  useEffect(() => {
    if (startedRef.current) return
    const key = serverKey ?? (typeof window !== 'undefined' ? window.localStorage.getItem(KEY_STORAGE) : null)
    if (!key) return
    startedRef.current = true
    void runAll(key)
  }, [runAll, serverKey])

  const pendingList = state?.pending ?? []
  const settings = state?.settings
  const hasData = settings && settings.source !== 'sample' && settings.source !== 'none'

  const summary = useMemo(() => {
    if (!settings) return 'Checking…'
    if (hasData) {
      return `Resolved ${settings.typeName ?? 'content'} — ${settings.propertyCount} properties (${settings.source}).`
    }
    return settings.error ?? 'No global settings captured yet.'
  }, [hasData, settings])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">1 · Optimizely Graph API key</h2>
        <p className="mt-1 text-sm text-slate-600">
          The key is only used by <em>your browser</em> to talk to Optimizely Graph directly; it is never sent anywhere
          else. Reading it from the CMS: <span className="font-medium">Settings → API Keys → Single key</span>.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Optimizely Graph single key"
            className="min-w-80 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500"
          />
          <button
            type="button"
            disabled={running || !apiKey}
            onClick={() => {
              window.localStorage.setItem(KEY_STORAGE, apiKey)
              startedRef.current = true
              void runAll(apiKey)
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {running ? 'Capturing…' : 'Capture content'}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={async () => {
              const result = await call({ action: 'reset' })
              if (result?.pending) setState(result)
              append('Cleared every captured response.')
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Reset cache
          </button>
        </div>
        {state?.hasServerKey ? (
          <p className="mt-2 text-xs text-slate-500">
            OPTIMIZELY_SINGLE_KEY is configured on the server, so the key was pre-filled.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">2 · Status</h2>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{summary}</p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Queued queries</dt>
            <dd className="font-medium text-slate-900">{pendingList.length}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Graph endpoint</dt>
            <dd className="truncate font-mono text-xs text-slate-700">{endpoint}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Content type</dt>
            <dd className="font-medium text-slate-900">{settings?.typeName ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Properties</dt>
            <dd className="font-medium text-slate-900">{settings?.propertyCount ?? 0}</dd>
          </div>
        </dl>
        <div className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-6 text-slate-100">
          {log.length ? log.map((line, index) => <div key={index}>{line}</div>) : <div>Waiting…</div>}
        </div>
      </section>

      {pendingList.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-900">3 · Manual capture (if the browser is blocked)</h2>
          <p className="mt-1 text-sm text-amber-900/80">
            Some networks block cross-origin requests to Optimizely Graph. In that case run the query in your terminal —
            for example with <code className="rounded bg-white/70 px-1">curl</code> — and paste the JSON response here.
          </p>
          <div className="mt-4 space-y-4">
            {pendingList.map((entry) => (
              <details key={entry.id} className="rounded-xl border border-amber-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">{entry.label}</summary>
                <p className="mt-1 text-xs text-slate-500">{entry.error}</p>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  {entry.query}
                </pre>
                <textarea
                  value={pasted[entry.id] ?? ''}
                  onChange={(event) => setPasted((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                  placeholder='Paste the Graph response JSON, e.g. {"data":{...}}'
                  className="mt-2 h-28 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-brand-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const parsed = JSON.parse(pasted[entry.id] ?? '')
                      const result = await call({ action: 'capture', id: entry.id, response: parsed })
                      append(`✓ ${entry.label} (pasted)`)
                      if (result?.pending) setState(result)
                    } catch (error) {
                      append(`✗ Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
                    }
                  }}
                  className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                >
                  Save response
                </button>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
