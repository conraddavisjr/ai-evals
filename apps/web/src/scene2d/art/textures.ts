import type Phaser from 'phaser'
import { CHAR_H, CHAR_W, type CharacterFrames, CIVILIAN, STAFF } from './characters.js'
import { CHARACTER_LOOKS, PALETTE, type Recolor } from './palette.js'
import { TILES } from './tiles.js'

/**
 * Compiles text grids into canvas textures at boot. This is the only place that
 * knows the art is procedural; swap it for a spritesheet loader and nothing else
 * in the scene changes.
 */
export interface SpriteSource {
  ensureCharacter(scene: Phaser.Scene, look: string): string
  ensureTile(scene: Phaser.Scene, name: string): string
}

function paint(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  ox: number,
  oy: number,
  recolor: Recolor = {},
) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] ?? ''
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] ?? '.'
      const color = recolor[ch] ?? PALETTE[ch]
      if (!color || color === 'transparent') continue
      ctx.fillStyle = color
      ctx.fillRect(ox + x, oy + y, 1, 1)
    }
  }
}

function mirror(grid: string[]): string[] {
  return grid.map((row) => row.split('').reverse().join(''))
}

export const FRAME_ORDER = [
  'down_0',
  'down_1',
  'up_0',
  'up_1',
  'right_0',
  'right_1',
  'left_0',
  'left_1',
] as const

export const proceduralSprites: SpriteSource = {
  ensureCharacter(scene, look) {
    const key = `char:${look}`
    if (scene.textures.exists(key)) return key
    const frames: CharacterFrames = look.startsWith('customer') ? CIVILIAN : STAFF
    const recolor = CHARACTER_LOOKS[look] ?? {}
    const canvas = document.createElement('canvas')
    canvas.width = CHAR_W * FRAME_ORDER.length
    canvas.height = CHAR_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const grids = [
      frames.down[0],
      frames.down[1],
      frames.up[0],
      frames.up[1],
      frames.side[0],
      frames.side[1],
      mirror(frames.side[0]),
      mirror(frames.side[1]),
    ]
    for (const [i, g] of grids.entries()) paint(ctx, g, i * CHAR_W, 0, recolor)
    const tex = scene.textures.addCanvas(key, canvas)
    if (!tex) throw new Error(`could not add texture ${key}`)
    for (const [i, name] of FRAME_ORDER.entries()) tex.add(name, 0, i * CHAR_W, 0, CHAR_W, CHAR_H)
    for (const dir of ['down', 'up', 'right', 'left'] as const) {
      const animKey = `${key}:walk_${dir}`
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: [
            { key, frame: `${dir}_0` },
            { key, frame: `${dir}_1` },
          ],
          frameRate: 6,
          repeat: -1,
        })
      }
    }
    return key
  },
  ensureTile(scene, name) {
    const key = `tile:${name}`
    if (scene.textures.exists(key)) return key
    const grid = TILES[name]
    if (!grid) throw new Error(`unknown tile ${name}`)
    const canvas = document.createElement('canvas')
    canvas.width = grid[0]?.length ?? 16
    canvas.height = grid.length
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    paint(ctx, grid, 0, 0)
    scene.textures.addCanvas(key, canvas)
    return key
  },
}
