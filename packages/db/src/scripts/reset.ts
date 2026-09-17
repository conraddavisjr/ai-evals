import { createDb } from '../client.js'
import { runMigrations } from '../migrate.js'
import { seedCatalog } from '../seed.js'

const { db, sql, close } = createDb()
await sql`drop schema public cascade`
await sql`create schema public`
await runMigrations(db)
await seedCatalog(db)
console.log('database reset, migrated, and seeded')
await close()
