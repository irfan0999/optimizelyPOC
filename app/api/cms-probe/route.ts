import { NextResponse } from 'next/server'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

const OUTPUT_DIR = path.join(process.cwd(), 'cms-probe-output')
const PENDING_FILE = path.join(OUTPUT_DIR, 'pending.json')

export interface ProbeQuery {
  id: string
  query: string
  variables?: Record<string, unknown>
}

async function readPending(): Promise<ProbeQuery[]> {
  try {
    return JSON.parse(await readFile(PENDING_FILE, 'utf8')) as ProbeQuery[]
  } catch {
    return []
  }
}

/** GET: return pending queries that do not have a result file yet */
export async function GET() {
  try {
    const pending = await readPending()
    const files = new Set(await readdir(OUTPUT_DIR).catch(() => [] as string[]))
    const next = pending.filter((q) => !files.has(`result-${q.id}.json`))
    return NextResponse.json({ queries: next })
  } catch (e) {
    return NextResponse.json({ queries: [], error: String(e) })
  }
}

/** POST: store a probe result coming from the browser bridge */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id: string
      response: unknown
    }
    const id = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) {
      return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 })
    }
    await mkdir(OUTPUT_DIR, { recursive: true })
    await writeFile(path.join(OUTPUT_DIR, `result-${id}.json`), JSON.stringify(body.response, null, 2))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
