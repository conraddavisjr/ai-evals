import { createDb } from '../client.js'
import { seedCatalog } from '../seed.js'

const { db, close } = createDb()
await seedCatalog(db)
console.log('catalog seeded')
await close()
