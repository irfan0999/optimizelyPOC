'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ProbeQuery {
  id: string
  query: string
  variables?: Record<string, unknown>
}

/**
 * TEMPORARY development bridge — runs GraphQL probes against Optimizely Graph
 * from the browser (the sandbox has no outbound network access to the CMS) and
 * posts the results back to the local Next.js server, which stores them on disk.
 * This component is removed once the CMS schema has been captured.
 */
export default function ProbeCollector({
  endpoint,
  singleKey,
  introspectionQuery,
}: {
  endpoint: string
  singleKey: string
  introspectionQuery: string
}) {
  const [log, setLog] = useState<string[]>(['Booting CMS probe…'])
  const doneRef = useRef<Set<string>>(new Set())

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`])
  }, [])

  const sendResult = useCallback(
    async (id: string, response: unknown) => {
      await fetch('/api/cms-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, response }),
      })
    },
    []
  )

  const runQuery = useCallback(
    async (id: string, query: string, variables?: Record<string, unknown>) => {
      append(`→ ${id}`)
      try {
        const res = await fetch(`${endpoint}?auth=${singleKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: variables ?? {} }),
        })
        const json = await res.json()
        if (json?.errors?.length) {
          append(`✗ ${id} — GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`)
        } else {
          append(`✓ ${id}`)
        }
        await sendResult(id, json)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        append(`✗ ${id} — network error: ${msg}`)
        await sendResult(id, { networkError: msg })
      }
    },
    [append, endpoint, sendResult, singleKey]
  )

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/cms-probe', { cache: 'no-store' })
        const data = (await res.json()) as { queries?: ProbeQuery[] }
        for (const q of data.queries ?? []) {
          if (cancelled || doneRef.current.has(q.id)) continue
          doneRef.current.add(q.id)
          await runQuery(q.id, q.query, q.variables)
        }
      } catch {
        // server not ready yet — retry on next tick
      }
    }

    const start = async () => {
      await runQuery('introspection', introspectionQuery)
      await poll()
    }
    void start()

    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [introspectionQuery, runQuery])

  return (
    <main className="mx-auto max-w-3xl p-8 font-mono">
      <h1 className="mb-2 text-2xl font-bold">Optimizely Graph — schema probe</h1>
      <p className="mb-6 text-sm text-gray-600">
        Keep this tab open. It runs GraphQL queries against {endpoint} from your browser
        and stores the results in the workspace. Nothing is sent anywhere else.
      </p>
      <div className="rounded border bg-gray-50 p-4 text-xs leading-6">
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </main>
  )
}
