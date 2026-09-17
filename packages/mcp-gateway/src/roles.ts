import type { Role } from '@cafe/protocol'

/**
 * The tool slice each role may hold. This table is the single source of truth:
 * the agent runtime advertises exactly these tools to the model, and the gateway
 * rejects anything outside them regardless of what the model asks for.
 */
export const ROLE_SCOPES: Record<Role, readonly string[]> = {
  cashier: ['menu', 'customers', 'orders:create', 'payments'],
  barista: ['orders:fulfil', 'recipes', 'inventory'],
  manager: ['orders:admin', 'staffing', 'inventory:restock', 'incidents', 'menu'],
  judge: [],
  customer: [],
}

export const scopesFor = (role: Role): readonly string[] => ROLE_SCOPES[role]
