import { getIntrospectionQuery } from 'graphql'
import ProbeCollector from '@/components/probe-collector'

/**
 * TEMPORARY root page used to collect the Optimizely Graph schema through the
 * user's browser (the sandbox cannot reach the CMS directly).
 * Replaced by the real CMS-driven homepage further along in this branch.
 */
export default function Home() {
  const endpoint = process.env.OPTIMIZELY_API_URL
  const singleKey = process.env.OPTIMIZELY_SINGLE_KEY

  if (!endpoint || !singleKey) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-bold">CMS probe not configured</h1>
        <p className="mt-2 text-gray-600">
          Set <code>OPTIMIZELY_API_URL</code> and <code>OPTIMIZELY_SINGLE_KEY</code> in{' '}
          <code>.env.local</code> and restart the dev server.
        </p>
      </main>
    )
  }

  return (
    <ProbeCollector
      endpoint={endpoint}
      singleKey={singleKey}
      introspectionQuery={getIntrospectionQuery()}
    />
  )
}
