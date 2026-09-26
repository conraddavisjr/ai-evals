import { loadEnv } from './env.js'

const envFile = loadEnv()

import { createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { serve } from '@hono/node-server'
import { createApp } from './http.js'
import { RunManager } from './run-manager.js'
import { SuiteRunner } from './suite-runner.js'
import { initTracing } from './telemetry/tracing.js'

const port = Number(process.env.PORT ?? 4747)
const allowLive = process.env.CAFE_ALLOW_LIVE_MODELS === 'true'
if (envFile) console.log(`[env] loaded ${envFile}`)

const { db } = createDb()
await runMigrations(db)
await seedCatalog(db)
const store = createPgStore(db)
// Spans: always into Postgres (the UI charts read them), and to OTLP when an endpoint is set.
if (process.env.CAFE_TRACING !== 'false') {
  const otlpUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  initTracing({ store, otlpUrl })
  console.log(`[tracing] spans -> postgres${otlpUrl ? ` + OTLP ${otlpUrl}` : ''}`)
}
const runs = new RunManager(store, allowLive)
const suites = new SuiteRunner(store, runs)
const orphans = await runs.reapOrphans()
if (orphans.length > 0)
  console.warn(
    `[runs] marked ${orphans.length} interrupted shift(s) as failed: ${orphans.join(', ')}`,
  )
const orphanSuites = await suites.reapOrphans()
if (orphanSuites.length > 0)
  console.warn(`[suites] marked ${orphanSuites.length} interrupted suite(s) as failed`)
const app = createApp({ store, runs, suites, allowLive })

serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Evals Cafe server on http://localhost:${port}  (live models: ${allowLive ? 'ENABLED' : 'disabled'})`,
  )
})
