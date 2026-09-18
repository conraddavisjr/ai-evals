import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_AISLE_ROW,
  CUSTOMER_SPOTS,
  route,
  STAFF_LANE_ROW,
  STAFF_SPOTS,
  worldX,
  worldZ,
} from './layout.js'

describe('scene3d layout', () => {
  it('maps tile centres to world units (x east, z south)', () => {
    expect(worldX(0)).toBe(0.5)
    expect(worldZ(12)).toBe(12.5)
  })
  it('routes customers through the aisle and staff along the lane', () => {
    const toRegister = route(CUSTOMER_SPOTS.door, CUSTOMER_SPOTS.register_1, CUSTOMER_AISLE_ROW)
    expect(toRegister).toEqual([
      { x: 17, y: 10 },
      { x: 3, y: 10 },
      { x: 3, y: 5 },
    ])
    const toPickup = route(STAFF_SPOTS.espresso_1, STAFF_SPOTS.pickup, STAFF_LANE_ROW)
    expect(toPickup).toEqual([{ x: 11, y: 3 }])
  })
})
