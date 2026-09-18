import type { Station } from '@cafe/protocol'

/**
 * The cafe is laid out on a 20 x 13 tile grid, 1 tile = 1 metre. Tile (x, y) sits at
 * world (x + 0.5, 0, y + 0.5): x runs east, z runs south, y is up.
 */
export const COLS = 20
export const ROWS = 13

export type Facing = 'down' | 'up' | 'left' | 'right'
export interface Spot {
  x: number
  y: number
  face: Facing
}

/** Where staff stand for each station (behind the counter, row 3). */
export const STAFF_SPOTS: Record<Station, Spot> = {
  register_1: { x: 3, y: 3, face: 'down' },
  register_2: { x: 6, y: 3, face: 'down' },
  espresso_1: { x: 4, y: 3, face: 'up' },
  espresso_2: { x: 7, y: 3, face: 'up' },
  pickup: { x: 11, y: 3, face: 'down' },
  office: { x: 16, y: 3, face: 'down' },
  judge_table: { x: 14, y: 7, face: 'down' },
  waiting: { x: 9, y: 3, face: 'down' },
  door: { x: 17, y: 11, face: 'up' },
  offscreen: { x: 17, y: 14, face: 'up' },
}

/** Where customers stand (in front of the counter, rows 5+). */
export const CUSTOMER_SPOTS: Record<Exclude<Station, 'waiting'>, Spot> = {
  register_1: { x: 3, y: 5, face: 'up' },
  register_2: { x: 6, y: 5, face: 'up' },
  pickup: { x: 11, y: 5, face: 'up' },
  espresso_1: { x: 4, y: 5, face: 'up' },
  espresso_2: { x: 7, y: 5, face: 'up' },
  office: { x: 16, y: 5, face: 'up' },
  judge_table: { x: 14, y: 9, face: 'up' },
  door: { x: 17, y: 11, face: 'up' },
  offscreen: { x: 17, y: 14, face: 'up' },
}

/** Waiting area slots, filled in order so customers do not stack. */
export const WAITING_SLOTS: Spot[] = [
  { x: 2, y: 7, face: 'up' },
  { x: 4, y: 7, face: 'up' },
  { x: 6, y: 7, face: 'up' },
  { x: 8, y: 7, face: 'up' },
  { x: 3, y: 8, face: 'up' },
  { x: 5, y: 8, face: 'up' },
  { x: 7, y: 8, face: 'up' },
  { x: 2, y: 9, face: 'up' },
  { x: 4, y: 9, face: 'up' },
  { x: 6, y: 9, face: 'up' },
]

/** Pickup counter overflow when several customers wait for drinks. */
export const PICKUP_SLOTS: Spot[] = [
  { x: 11, y: 5, face: 'up' },
  { x: 12, y: 5, face: 'up' },
  { x: 10, y: 6, face: 'up' },
  { x: 12, y: 6, face: 'up' },
]

/** Customers travel along the row-10 aisle; staff along the row-3 lane. */
export const CUSTOMER_AISLE_ROW = 10
export const STAFF_LANE_ROW = 3

/** Tile centre in world units (x east, z south). */
export const worldX = (tx: number) => tx + 0.5
export const worldZ = (ty: number) => ty + 0.5

/** Manhattan route through the aisle so actors do not walk through furniture. */
export function route(from: Spot, to: Spot, aisleRow: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  if (from.x === to.x || from.y === to.y) {
    pts.push({ x: to.x, y: to.y })
    return pts
  }
  if (from.y !== aisleRow) pts.push({ x: from.x, y: aisleRow })
  pts.push({ x: to.x, y: aisleRow })
  if (to.y !== aisleRow) pts.push({ x: to.x, y: to.y })
  return pts
}

export const FACING_YAW: Record<Facing, number> = {
  down: 0, // facing +z (towards the camera side / south)
  up: Math.PI,
  right: -Math.PI / 2,
  left: Math.PI / 2,
}
