import { createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { serve } from '@hono/node-server'
import { createApp } from './http.js'
import { RunManager } from './run-manager.js'

const port = Number(process.env.PORT ?? 4747)
const allowLive = process.env.CAFE_ALLOW_LIVE_MODELS === 'true'

const { db } = createDb()
await runMigrations(db)
await seedCatalog(db)
const store = createPgStore(db)
const runs = new RunManager(store, allowLive)
const orphans = await runs.reapOrphans()
if (orphans.length > 0)
  console.warn(
    `[runs] marked ${orphans.length} interrupted shift(s) as failed: ${orphans.join(', ')}`,
  )
const app = createApp({ store, runs, allowLive })

serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Stardust Cafe server on http://localhost:${port}  (live models: ${allowLive ? 'ENABLED' : 'disabled'})`,
  )
})
