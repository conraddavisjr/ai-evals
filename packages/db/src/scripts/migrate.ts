import { createDb } from '../client.js'
import { runMigrations } from '../migrate.js'

const { db, close } = createDb()
await runMigrations(db)
console.log('migrations applied')
await close()
