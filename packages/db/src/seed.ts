import type { Db } from './client.js'
import * as s from './schema.js'
import { CUSTOMERS, INGREDIENTS, MENU, RECIPES } from './seed-data.js'

/** Idempotent: upserts the catalog so re-seeding never duplicates. Leaves run data alone. */
export async function seedCatalog(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const row of INGREDIENTS) {
      await tx
        .insert(s.ingredients)
        .values(row)
        .onConflictDoUpdate({ target: s.ingredients.sku, set: row })
    }
    for (const row of MENU) {
      await tx
        .insert(s.menuItems)
        .values(row)
        .onConflictDoUpdate({ target: s.menuItems.id, set: row })
    }
    for (const row of RECIPES) {
      await tx
        .insert(s.recipes)
        .values(row)
        .onConflictDoUpdate({ target: s.recipes.menuItemId, set: row })
    }
    for (const row of CUSTOMERS) {
      await tx
        .insert(s.customers)
        .values(row)
        .onConflictDoUpdate({ target: s.customers.loyaltyId, set: row })
    }
  })
}
