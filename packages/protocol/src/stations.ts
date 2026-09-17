import type { Role, Station } from './domain.js'

/** Where each role idles and works. The scene uses the same table for waypoints. */
export const HOME_STATION: Record<Role, Station> = {
  cashier: 'register_1',
  barista: 'espresso_1',
  manager: 'office',
  judge: 'judge_table',
  customer: 'door',
}

export const REGISTERS: Station[] = ['register_1', 'register_2']
export const ESPRESSO_MACHINES: Station[] = ['espresso_1', 'espresso_2']
