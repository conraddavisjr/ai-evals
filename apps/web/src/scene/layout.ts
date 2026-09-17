import type { Station } from '@cafe/protocol'

export const TILE = 16
export const COLS = 20
export const ROWS = 13
/**
 * Integer render scale: everything is drawn at 16px and scaled by S so pixels stay crisp.
 * Chosen once at boot from the available space (x2 on a laptop, x3 on a big screen).
 */
export let S = 3
export function configureScale(availW: number, availH: number): number {
  S = Math.max(1, Math.min(4, Math.floor(Math.min(availW / (COLS * TILE), availH / (ROWS * TILE)))))
  return S
}
export const worldW = () => COLS * TILE * S
export const worldH = () => ROWS * TILE * S

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

export const pxX = (tx: number) => tx * TILE * S + (TILE * S) / 2
export const pxY = (ty: number) => (ty + 1) * TILE * S

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

/** Tile map: which tile texture at each (col,row), plus props layered on top. */
export interface Placement {
  tile: string
  x: number
  y: number
  depthBias?: number
}

export function buildMap(): { ground: Placement[]; props: Placement[] } {
  const ground: Placement[] = []
  const props: Placement[] = []
  const put = (arr: Placement[], tile: string, x: number, y: number, depthBias = 0) =>
    arr.push({ tile, x, y, depthBias })

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const edge = x === 0 || x === COLS - 1 || y === ROWS - 1
      if (y === 0) put(ground, 'wall_top', x, y)
      else if (edge) put(ground, 'trim', x, y)
      else if (y === 1) put(ground, 'wall', x, y)
      else if (y === 2 || y === 3)
        put(ground, x <= 13 || x >= 15 ? 'floor_tile' : 'floor_tile', x, y)
      else put(ground, 'floor_wood', x, y)
    }
  }
  // door in the bottom wall
  put(ground, 'door', 17, ROWS - 1)
  // wall dressing
  put(props, 'menu_board_l', 3, 1)
  put(props, 'menu_board_r', 4, 1)
  put(props, 'window', 10, 1)
  put(props, 'shelf', 12, 1)
  put(props, 'window', 16, 1)
  // back counter with machines
  for (let x = 1; x <= 13; x++) put(ground, 'counter_back', x, 2)
  put(props, 'grinder', 2, 2)
  put(props, 'espresso', 4, 2)
  put(props, 'espresso', 7, 2)
  put(props, 'cups', 9, 2)
  put(props, 'pastry_case', 12, 2)
  // office
  put(props, 'partition', 14, 2)
  put(props, 'partition', 14, 3)
  put(props, 'desk', 16, 2)
  put(props, 'plant', 18, 2)
  // front counter
  for (let x = 1; x <= 13; x++) put(ground, 'counter_front', x, 4)
  put(props, 'register', 3, 4)
  put(props, 'register', 6, 4)
  put(props, 'pickup_tray', 11, 4)
  // seating
  put(props, 'table', 9, 8)
  put(props, 'chair', 8, 8)
  put(props, 'chair', 10, 8)
  put(props, 'table', 14, 8)
  put(props, 'chair', 13, 8)
  put(props, 'chair', 15, 8)
  put(ground, 'rug_l', 9, 9)
  put(ground, 'rug_r', 10, 9)
  put(props, 'plant', 1, 5)
  put(props, 'plant', 18, 5)
  put(props, 'plant', 1, 11)
  return { ground, props }
}
