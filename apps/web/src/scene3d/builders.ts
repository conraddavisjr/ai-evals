import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glow, mat, softDotTexture, textTexture } from './materials.js'
import { P } from './palette.js'

/** Deterministic PRNG so the plaza looks the same every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shadowed = <T extends THREE.Object3D>(o: T, cast = true, receive = true): T => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast
      c.receiveShadow = receive
    }
  })
  return o
}

/** Painted local-space lighting survives static batching and costs no extra draw calls. */
function paintGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox()
  const bounds = g.boundingBox
  if (!bounds) return g
  const height = Math.max(0.001, bounds.max.y - bounds.min.y)
  const pos = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - bounds.min.y) / height
    const ny = normal.getY(i)
    // Cool pooled shadow at the foot, broad brush gradient, pale upper bevel.
    const edge = ny > 0.12 && ny < 0.97 && y > 0.55 ? 0.16 : 0
    const value = 0.59 + y * 0.3 + Math.max(0, ny) * 0.12 + edge
    colors[i * 3] = value * (0.91 + y * 0.09)
    colors[i * 3 + 1] = value
    colors[i * 3 + 2] = value * (1.08 - y * 0.08)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

/** Chunky beveled block: the workhorse of the whole style. */
export function block(
  w: number,
  h: number,
  d: number,
  color: string,
  opts: { radius?: number; emissive?: string; emissiveIntensity?: number; opacity?: number } = {},
): THREE.Mesh {
  const r = Math.min(opts.radius ?? Math.min(w, h, d) * 0.22, Math.min(w, h, d) / 2 - 0.001)
  const g = paintGeometry(new RoundedBoxGeometry(w, h, d, 2, r))
  const m = new THREE.Mesh(
    g,
    mat(color, {
      vertexColors: true,
      emissive: opts.emissive,
      emissiveIntensity: opts.emissiveIntensity,
      opacity: opts.opacity,
    }),
  )
  m.position.y = h / 2
  return shadowed(m)
}

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  color: string,
  segments = 12,
  opts: { emissive?: string; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(
    paintGeometry(new THREE.CylinderGeometry(rTop, rBottom, h, segments)),
    mat(color, { ...opts, vertexColors: true }),
  )
  m.position.y = h / 2
  return shadowed(m)
}

export function sphere(
  r: number,
  color: string,
  opts: { emissive?: string; emissiveIntensity?: number; segments?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(
    paintGeometry(new THREE.SphereGeometry(r, opts.segments ?? 12, opts.segments ?? 10)),
    mat(color, { ...opts, vertexColors: true }),
  )
  return shadowed(m)
}

export function at(o: THREE.Object3D, x: number, z: number, y = 0, rotY = 0): THREE.Object3D {
  o.position.set(x, y, z)
  o.rotation.y = rotY
  return o
}

// ---------- ground ----------

/** Cobblestones as one merged mesh with per-stone colour; the dark base below reads as grout / baked AO. */
export function cobblestones(cols: number, rows: number, seed = 7): THREE.Group {
  const g = new THREE.Group()
  const rand = rng(seed)
  const geos: THREE.BufferGeometry[] = []
  const color = new THREE.Color()
  // Irregular flagstones: staggered rows, varied sizes, small gaps that read as grout.
  for (let z = 0; z < rows * 2; z++) {
    const rowOffset = (z % 2) * 0.33
    let x = -0.2 + rowOffset
    while (x < cols + 0.3) {
      const w = 0.55 + rand() * 0.45
      const d = 0.42 + rand() * 0.1
      {
        const h = 0.1 + rand() * 0.05
        const geo = new RoundedBoxGeometry(w, h, d, 2, 0.07)
        const px = x + w / 2
        const pz = z * 0.5 + 0.25 + (rand() - 0.5) * 0.04
        geo.rotateY((rand() - 0.5) * 0.12)
        geo.translate(px, h / 2 - 0.02, pz)
        const base = P.cobble[Math.floor(rand() * P.cobble.length)] ?? '#8b8a93'
        color.set(base).offsetHSL(0, 0, (rand() - 0.5) * 0.06)
        const pos = geo.getAttribute('position')
        const n = pos.count
        const colors = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          // darken lower vertices: cheap baked ambient occlusion
          const yy = pos.getY(i)
          const k2 = yy < h * 0.3 - 0.02 ? 0.55 : 1
          colors[i * 3] = color.r * k2
          colors[i * 3 + 1] = color.g * k2
          colors[i * 3 + 2] = color.b * k2
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geos.push(geo)
      }
      x += w + 0.06
    }
  }
  const merged = mergeGeometries(geos, false)
  if (merged) {
    const mesh = new THREE.Mesh(merged, mat('#ffffff', { vertexColors: true }))
    mesh.receiveShadow = true
    g.add(mesh)
  }
  const grout = new THREE.Mesh(new THREE.BoxGeometry(cols + 2, 0.3, rows + 2), mat(P.cobbleDark))
  grout.position.set(cols / 2, -0.17, rows / 2)
  grout.receiveShadow = true
  g.add(grout)
  return g
}

// ---------- kiosk furniture ----------

export function counter(length: number, depth = 0.9): THREE.Group {
  const g = new THREE.Group()
  const base = block(length, 0.85, depth, P.timber, { radius: 0.05 })
  g.add(base)
  const top = block(length + 0.15, 0.12, depth + 0.15, P.plank, { radius: 0.05 })
  top.position.y = 0.85 + 0.06
  g.add(top)
  // front panelling
  for (let i = 0; i < Math.floor(length); i++) {
    const panel = block(0.7, 0.55, 0.05, P.timberDark, { radius: 0.02 })
    panel.position.set(-length / 2 + 0.5 + i, 0.4, depth / 2 + 0.02)
    g.add(panel)
  }
  return g
}

/** Brass till: boxy, angled top, glowing display. Reads as "money", not "coffee". */
export function register(): THREE.Group {
  const g = new THREE.Group()
  const body = block(0.78, 0.32, 0.62, '#336c68', { radius: 0.06 })
  g.add(body)
  const slope = block(0.72, 0.18, 0.46, '#4e9690', { radius: 0.05 })
  slope.position.set(0, 0.38, -0.05)
  slope.rotation.x = -0.5
  g.add(slope)
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.22, 0.05), glow('#9fe8ff', 1.6))
  display.position.set(0, 0.62, -0.08)
  display.rotation.x = -0.35
  g.add(display)
  const keys = block(0.6, 0.06, 0.2, '#f1e5c4', { radius: 0.02 })
  keys.position.set(0, 0.34, 0.12)
  g.add(keys)
  const drawer = block(0.7, 0.08, 0.04, '#8b6a2e', { radius: 0.02 })
  drawer.position.set(0, 0.1, 0.25)
  g.add(drawer)
  return g
}

/** Copper espresso machine: tall round boiler, brass heads, a steam wand. Reads as "coffee". */
export function espressoMachine(): THREE.Group {
  const g = new THREE.Group()
  const base = block(0.9, 0.35, 0.7, P.iron, { radius: 0.06 })
  g.add(base)
  const boiler = cylinder(0.42, 0.44, 0.7, P.copper, 16)
  boiler.position.set(0, 0.35 + 0.35, -0.05)
  g.add(boiler)
  const lid = cylinder(0.25, 0.44, 0.2, '#d98c5a', 16)
  lid.position.set(0, 1.05 + 0.07, -0.05)
  g.add(lid)
  const dome = sphere(0.14, P.brass)
  dome.position.set(0, 1.25, -0.05)
  g.add(dome)
  for (const dx of [-0.25, 0.25]) {
    const head = cylinder(0.1, 0.12, 0.16, P.brass, 10)
    head.position.set(dx, 0.35 + 0.08, 0.28)
    g.add(head)
    const handle = block(0.06, 0.05, 0.25, P.timberDark, { radius: 0.02 })
    handle.position.set(dx, 0.38, 0.45)
    g.add(handle)
  }
  const wand = cylinder(0.02, 0.02, 0.4, '#d5dde6', 8)
  wand.position.set(0.48, 0.55, 0.15)
  wand.rotation.z = 0.5
  g.add(wand)
  const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), glow('#ffd27a', 1.2))
  gauge.position.set(0, 0.85, 0.4)
  g.add(gauge)
  const cup = cylinder(0.07, 0.06, 0.1, P.paper, 10)
  cup.position.set(-0.25, 0.42, 0.28)
  g.add(cup)
  return g
}

export function grinder(): THREE.Group {
  const g = new THREE.Group()
  g.add(block(0.4, 0.5, 0.4, P.iron, { radius: 0.06 }))
  const hopper = cylinder(0.22, 0.12, 0.35, '#c8dbe6', 12)
  hopper.position.y = 0.5 + 0.17
  g.add(hopper)
  return g
}

export function pastryCase(): THREE.Group {
  const g = new THREE.Group()
  const shelf = block(1.1, 0.14, 0.7, P.timber, { radius: 0.03 })
  g.add(shelf)
  const glass = block(1.05, 0.7, 0.65, '#cfe8f2', { radius: 0.04, opacity: 0.28 })
  glass.position.y = 0.14 + 0.35
  glass.castShadow = false
  g.add(glass)
  const rand = rng(3)
  for (let i = 0; i < 6; i++) {
    const p = sphere(0.09 + rand() * 0.04, i % 2 ? '#e0a45a' : '#c95a6a', { segments: 8 })
    p.position.set(-0.35 + (i % 3) * 0.35, 0.28 + Math.floor(i / 3) * 0.28, -0.1 + (i % 2) * 0.2)
    g.add(p)
  }
  const light = new THREE.PointLight('#ffc78a', 6, 3, 2)
  light.position.set(0, 0.6, 0)
  g.add(light)
  return g
}

export function backBar(length: number): THREE.Group {
  const g = new THREE.Group()
  const board = block(length, 2.2, 0.25, P.timberDark, { radius: 0.04 })
  board.position.z = -0.35
  g.add(board)
  for (const y of [1.2, 1.7]) {
    const shelf = block(length - 0.3, 0.08, 0.4, P.plank, { radius: 0.02 })
    shelf.position.set(0, y, -0.15)
    g.add(shelf)
  }
  const rand = rng(11)
  for (let i = 0; i < Math.floor(length * 1.6); i++) {
    const x = -length / 2 + 0.3 + i * 0.6 + rand() * 0.15
    const y = i % 2 ? 1.24 : 1.74
    if (i % 3 === 0) {
      const jar = cylinder(
        0.09,
        0.09,
        0.22,
        ['#d9b25a', '#c94a3d', '#6fa25a'][i % 3] ?? P.brass,
        10,
      )
      jar.position.set(x, y, -0.15)
      g.add(jar)
    } else {
      const mug = cylinder(
        0.08,
        0.07,
        0.16,
        ['#f6efdd', '#37a3c9', '#e46c8a'][i % 3] ?? P.paper,
        10,
      )
      mug.position.set(x, y, -0.15)
      g.add(mug)
    }
  }
  // candles on the top shelf
  for (const x of [-length / 2 + 0.9, length / 2 - 0.9]) {
    const candle = cylinder(0.05, 0.05, 0.16, P.paper, 8)
    candle.position.set(x, 1.74, -0.15)
    g.add(candle)
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softDotTexture(),
        color: '#ffb15c',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    flame.scale.set(0.25, 0.35, 1)
    flame.position.set(x, 1.98, -0.15)
    g.add(flame)
  }
  return g
}

/** Scalloped striped canopy on posts. */
export function awning(
  length: number,
  depth: number,
  heightFront = 2.3,
  heightBack = 2.7,
): THREE.Group {
  const g = new THREE.Group()
  const stripes = Math.max(4, Math.round(length / 0.55))
  const stripeW = length / stripes
  const tilt = Math.atan2(heightBack - heightFront, depth)
  for (let i = 0; i < stripes; i++) {
    const s = block(stripeW + 0.01, 0.08, depth, i % 2 ? P.awningA : P.awningB, { radius: 0.02 })
    s.position.set(-length / 2 + stripeW / 2 + i * stripeW, (heightFront + heightBack) / 2, 0)
    s.rotation.x = tilt
    g.add(s)
    const scallop = cylinder(stripeW / 2, stripeW / 2, 0.08, i % 2 ? P.awningA : P.awningB, 12)
    scallop.rotation.z = Math.PI / 2
    scallop.rotation.y = Math.PI / 2
    scallop.position.set(-length / 2 + stripeW / 2 + i * stripeW, heightFront - 0.02, depth / 2)
    scallop.scale.set(1, 1, 0.5)
    g.add(scallop)
  }
  for (const x of [-length / 2 + 0.2, length / 2 - 0.2]) {
    const post = block(0.16, heightFront, 0.16, P.timber, { radius: 0.04 })
    post.position.set(x, 0, depth / 2 - 0.1)
    g.add(post)
  }
  return g
}

export function ticketRail(length: number): THREE.Group {
  const g = new THREE.Group()
  for (const x of [-length / 2, length / 2]) {
    const post = block(0.12, 1.6, 0.12, P.iron, { radius: 0.02 })
    post.position.set(x, 0.97, 0)
    g.add(post)
  }
  const wire = cylinder(0.035, 0.035, length, '#dbc394', 8)
  wire.rotation.z = Math.PI / 2
  wire.position.set(0, 2.45, 0)
  g.add(wire)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.52),
    new THREE.MeshBasicMaterial({
      map: textTexture('ORDER UP', { color: '#f6efdd', bg: '#173d43', w: 320, h: 100 }),
      toneMapped: false,
    }),
  )
  g.add(at(block(2.48, 0.68, 0.13, P.brass), 0, -0.08, 2.8))
  sign.position.set(0, 2.8, 0.01)
  g.add(sign)
  const lantern = lanternHead(false)
  lantern.position.set(0, 3.15, 0)
  g.add(lantern)
  return g
}

export function ticketCard(): THREE.Mesh {
  const m = block(0.48, 0.58, 0.04, P.paper, { radius: 0.02 })
  m.castShadow = false
  m.add(at(block(0.09, 0.17, 0.07, P.copper), 0, 0.03, 0.27))
  for (const y of [-0.08, 0.01]) m.add(at(block(0.28, 0.018, 0.01, '#9dbaa9'), 0, 0.03, y))
  return m
}

// ---------- lights ----------

export interface Flicker {
  light: THREE.PointLight
  sprite: THREE.Sprite
  base: number
  phase: number
}
export const flickers: Flicker[] = []

function lanternHead(withLight = true): THREE.Group {
  const g = new THREE.Group()
  const cage = block(0.34, 0.42, 0.34, P.iron, { radius: 0.04 })
  cage.castShadow = false
  g.add(cage)
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), glow('#ffb15c', 1.9))
  pane.position.y = 0.2
  g.add(pane)
  const cap = block(0.42, 0.1, 0.42, P.iron, { radius: 0.03 })
  cap.position.y = 0.44
  g.add(cap)
  const light = new THREE.PointLight('#ffa552', 12, 7, 2)
  light.position.y = 0.2
  if (withLight) g.add(light)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: '#ffb15c',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  sprite.scale.set(1.0, 1.0, 1)
  sprite.position.y = 0.2
  g.add(sprite)
  flickers.push({ light, sprite, base: 12, phase: Math.random() * 10 })
  return g
}

export function lampPost(): THREE.Group {
  const g = new THREE.Group()
  const foot = cylinder(0.16, 0.22, 0.2, P.iron, 10)
  g.add(foot)
  const pole = cylinder(0.05, 0.07, 2.2, P.iron, 8)
  pole.position.y = 0.2 + 1.1
  g.add(pole)
  const head = lanternHead()
  head.position.y = 2.45
  g.add(head)
  return g
}

export function brazier(): THREE.Group {
  const g = new THREE.Group()
  const legs = cylinder(0.28, 0.22, 0.35, P.iron, 8)
  g.add(legs)
  const bowl = cylinder(0.42, 0.28, 0.32, P.iron, 12)
  bowl.position.y = 0.35 + 0.16
  g.add(bowl)
  const coals = cylinder(0.32, 0.32, 0.08, '#ff7a2a', 12, {
    emissive: '#ff5a1a',
    emissiveIntensity: 2,
  })
  coals.position.y = 0.62
  g.add(coals)
  const light = new THREE.PointLight('#ff8a3c', 18, 8, 2)
  light.position.y = 1.1
  g.add(light)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: '#ff9a3c',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  sprite.scale.set(1.1, 1.6, 1)
  sprite.position.y = 1.15
  g.add(sprite)
  flickers.push({ light, sprite, base: 18, phase: Math.random() * 10 })
  return g
}

// ---------- plaza props ----------

export function table(): THREE.Group {
  const g = new THREE.Group()
  const top = cylinder(0.55, 0.55, 0.1, P.plank, 16)
  top.position.y = 0.75
  g.add(top)
  const leg = cylinder(0.08, 0.14, 0.7, P.iron, 8)
  leg.position.y = 0.35
  g.add(leg)
  const candle = cylinder(0.05, 0.05, 0.12, P.paper, 8)
  candle.position.y = 0.86
  g.add(candle)
  const flame = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: '#ffb15c',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  flame.scale.set(0.3, 0.4, 1)
  flame.position.y = 1.02
  g.add(flame)
  return g
}

export function chair(): THREE.Group {
  const g = new THREE.Group()
  const seat = block(0.45, 0.08, 0.45, P.plank, { radius: 0.03 })
  seat.position.y = 0.42
  g.add(seat)
  const back = block(0.45, 0.45, 0.07, P.timber, { radius: 0.03 })
  back.position.set(0, 0.68, -0.19)
  g.add(back)
  for (const [dx, dz] of [
    [-0.17, -0.17],
    [0.17, -0.17],
    [-0.17, 0.17],
    [0.17, 0.17],
  ] as const) {
    const leg = block(0.06, 0.4, 0.06, P.timberDark, { radius: 0.02 })
    leg.position.set(dx, 0, dz)
    g.add(leg)
  }
  return g
}

export function planter(): THREE.Group {
  const g = new THREE.Group()
  g.add(block(0.8, 0.45, 0.8, P.stone, { radius: 0.08 }))
  const moss = sphere(0.42, P.moss, { segments: 10 })
  moss.scale.set(1, 0.6, 1)
  moss.position.y = 0.5
  g.add(moss)
  const rand = rng(5)
  for (let i = 0; i < 5; i++) {
    const f = sphere(0.07, i % 2 ? P.flower : '#f2c94c', { segments: 6 })
    f.position.set((rand() - 0.5) * 0.5, 0.72 + rand() * 0.1, (rand() - 0.5) * 0.5)
    g.add(f)
  }
  return g
}

export function crate(): THREE.Mesh {
  return block(0.6, 0.6, 0.6, P.plank, { radius: 0.05 })
}

export function barrel(): THREE.Group {
  const g = new THREE.Group()
  const body = cylinder(0.32, 0.28, 0.75, P.timber, 12)
  g.add(body)
  for (const y of [0.15, 0.6]) {
    const band = cylinder(0.335, 0.335, 0.06, P.iron, 12)
    band.position.y = y
    g.add(band)
  }
  return g
}

/** Round stone fountain; the water disc gets its animated material from effects.ts. */
export function fountain(): { group: THREE.Group; water: THREE.Mesh } {
  const g = new THREE.Group()
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.18, 10, 24), mat(P.stone))
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.3
  shadowed(rim)
  g.add(rim)
  const wall = cylinder(1.05, 1.1, 0.3, P.stoneDark, 24)
  g.add(wall)
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32))
  water.rotation.x = -Math.PI / 2
  water.position.y = 0.28
  g.add(water)
  const pillar = cylinder(0.12, 0.16, 0.8, P.stone, 10)
  pillar.position.y = 0.3
  g.add(pillar)
  const bowl = cylinder(0.34, 0.1, 0.16, P.stone, 14)
  bowl.position.y = 1.05
  g.add(bowl)
  const orb = sphere(0.12, '#bfe9ff', { emissive: '#7fd4ff', emissiveIntensity: 0.8 })
  orb.position.y = 1.25
  g.add(orb)
  const light = new THREE.PointLight('#7fd4ff', 2.5, 4, 2)
  light.position.y = 1.4
  g.add(light)
  return { group: g, water }
}

export function gate(): THREE.Group {
  const g = new THREE.Group()
  for (const x of [-0.75, 0.75]) {
    const pillar = block(0.5, 2.4, 0.5, P.stone, { radius: 0.08 })
    pillar.position.x = x
    g.add(pillar)
    const cap = block(0.62, 0.18, 0.62, P.stoneDark, { radius: 0.05 })
    cap.position.set(x, 2.4, 0)
    g.add(cap)
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.2, 10, 20, Math.PI), mat(P.stone))
  arch.position.y = 2.3
  shadowed(arch)
  g.add(arch)
  return g
}

export function stoneWall(length: number): THREE.Group {
  const g = new THREE.Group()
  const wall = block(length, 0.7, 0.45, P.stone, { radius: 0.06 })
  g.add(wall)
  const cap = block(length + 0.1, 0.12, 0.55, P.stoneDark, { radius: 0.04 })
  cap.position.y = 0.7
  g.add(cap)
  const rand = rng(21)
  for (let i = 0; i < length * 0.7; i++) {
    const ivy = sphere(0.18 + rand() * 0.12, i % 2 ? P.moss : P.mossDark, { segments: 7 })
    ivy.position.set(-length / 2 + rand() * length, 0.35 + rand() * 0.45, 0.22 + rand() * 0.1)
    g.add(ivy)
  }
  return g
}

/** A cottage facade: plaster, timber frame, glowing windows, beveled slate roof. */
export function cottage(
  w: number,
  d: number,
  h: number,
  opts: { door?: boolean; windows?: number } = {},
): THREE.Group {
  const g = new THREE.Group()
  const body = block(w, h, d, P.plaster, { radius: 0.06 })
  g.add(body)
  g.add(at(block(w + 0.18, 0.42, d + 0.16, P.stoneDark), 0, 0, 0.12))
  // timber frame lines on the front face (+z)
  for (const x of [-w / 2 + 0.15, 0, w / 2 - 0.15]) {
    const beam = block(0.14, h - 0.2, 0.1, P.timberDark, { radius: 0.03 })
    beam.position.set(x, 0.1, d / 2)
    g.add(beam)
  }
  const sill = block(w, 0.14, 0.12, P.timberDark, { radius: 0.03 })
  sill.position.set(0, h * 0.55, d / 2)
  g.add(sill)
  const windows = opts.windows ?? 2
  for (let i = 0; i < windows; i++) {
    const x = -w / 2 + (w / (windows + 1)) * (i + 1)
    const frame = block(0.6, 0.7, 0.1, P.timberDark, { radius: 0.03 })
    frame.position.set(x, h * 0.55 + 0.2, d / 2 + 0.02)
    g.add(frame)
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.58, 0.06), glow('#ffcf8a', 1.35))
    pane.position.set(x, h * 0.55 + 0.55, d / 2 + 0.06)
    g.add(pane)
    for (const side of [-1, 1]) {
      g.add(at(block(0.22, 0.73, 0.12, '#3e7472'), x + side * 0.44, d / 2 + 0.09, h * 0.55 + 0.55))
      const brace = block(0.1, h * 0.42, 0.12, P.timberDark)
      brace.rotation.z = side * 0.65
      g.add(at(brace, x + side * 0.44, d / 2 + 0.04, h * 0.3))
    }
    g.add(at(block(0.06, 0.6, 0.08, P.timberDark), x, d / 2 + 0.11, h * 0.55 + 0.55))
    g.add(at(block(0.55, 0.06, 0.08, P.timberDark), x, d / 2 + 0.11, h * 0.55 + 0.55))
    g.add(at(block(1.05, 0.14, 0.32, P.stone), x, d / 2 + 0.12, h * 0.55 + 0.12))
  }
  if (opts.door) {
    const door = block(0.8, 1.5, 0.1, '#a8632b', { radius: 0.05 })
    door.position.set(0, 0, d / 2 + 0.03)
    g.add(door)
  }
  // roof: two beveled slabs meeting at the ridge, in slate lavender
  const roofDepth = d + 0.7
  const slabW = Math.hypot(w / 2 + 0.35, 1.2)
  for (const side of [-1, 1]) {
    const slab = block(slabW, 0.16, roofDepth, P.roof, { radius: 0.04 })
    slab.position.set(side * (w / 4 + 0.15), h + 0.55, 0)
    slab.rotation.z = side * -Math.atan2(1.2, w / 2 + 0.35)
    g.add(slab)
    const courses = 5
    const tiles = Math.ceil(roofDepth / 0.55)
    for (let row = 0; row < courses; row++) {
      for (let col = 0; col < tiles; col++) {
        const tile = block(
          slabW / courses + 0.06,
          0.095,
          roofDepth / tiles - 0.035,
          row % 2 ? P.roof : '#396e78',
          { radius: 0.04 },
        )
        tile.position.set(
          -slabW / 2 + ((row + 0.5) * slabW) / courses,
          0.12,
          -roofDepth / 2 + ((col + 0.5) * roofDepth) / tiles,
        )
        slab.add(tile)
      }
    }
    // a darker eave strip along the lower edge sells the tile rows
    const eave = block(0.1, 0.05, roofDepth - 0.05, P.roofDark, { radius: 0.01 })
    eave.position.set(side * (w / 2 + 0.3), h + 0.02, 0)
    g.add(eave)
  }
  const ridge = block(0.25, 0.2, roofDepth + 0.1, P.roofDark, { radius: 0.06 })
  ridge.position.set(0, h + 1.15, 0)
  g.add(ridge)
  const chimney = block(0.4, 0.9, 0.4, P.stoneDark, { radius: 0.05 })
  chimney.position.set(w / 4, h + 0.6, -d / 4)
  g.add(chimney)
  g.add(at(block(0.58, 0.16, 0.58, P.stone), w / 4, -d / 4, h + 1.1))
  // A little copper-roofed dormer breaks the broad roof silhouette.
  g.add(at(block(0.95, 0.85, 0.65, P.plaster), -w * 0.2, d * 0.3, h + 0.65))
  g.add(
    at(
      block(0.46, 0.52, 0.08, '#f3bb69', { emissive: '#e89c48', emissiveIntensity: 0.45 }),
      -w * 0.2,
      d * 0.3 + 0.35,
      h + 0.65,
    ),
  )
  for (const side of [-1, 1]) {
    const hood = block(0.72, 0.14, 0.92, P.copper)
    hood.rotation.z = side * -0.55
    g.add(at(hood, -w * 0.2 + side * 0.25, d * 0.3, h + 1.2))
  }
  return g
}

export function desk(): THREE.Group {
  const g = new THREE.Group()
  const top = block(1.3, 0.1, 0.7, P.plank, { radius: 0.03 })
  top.position.y = 0.75
  g.add(top)
  for (const x of [-0.55, 0.55]) {
    const side = block(0.12, 0.75, 0.6, P.timberDark, { radius: 0.03 })
    side.position.x = x
    g.add(side)
  }
  const ledger = block(0.4, 0.06, 0.3, '#7a3b2e', { radius: 0.02 })
  ledger.position.set(-0.3, 0.85, 0)
  ledger.rotation.y = 0.2
  g.add(ledger)
  const lamp = lanternHead(false)
  lamp.scale.setScalar(0.6)
  lamp.position.set(0.4, 0.85, -0.1)
  g.add(lamp)
  return g
}

/**
 * Bake every static toon mesh in a group into one mesh per material. Sprites, points,
 * shader materials and anything flagged `userData.dynamic` are left alone. Turns a few
 * hundred draw calls (twice, with shadows) into a couple of dozen.
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const buckets = new Map<
    THREE.Material,
    { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }
  >()
  const victims: THREE.Mesh[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as unknown as THREE.Sprite).isSprite || o.userData.dynamic) return
    const material = m.material as THREE.Material
    if (Array.isArray(m.material) || !(material as THREE.MeshToonMaterial).isMeshToonMaterial)
      return
    let hasDynamicAncestor = false
    for (let p: THREE.Object3D | null = o; p; p = p.parent)
      if (p.userData.dynamic) hasDynamicAncestor = true
    if (hasDynamicAncestor) return
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    for (const name of Object.keys(geo.attributes))
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color')
        geo.deleteAttribute(name)
    if (geo.index) geo.setIndex(geo.index) // keep indexing; mergeGeometries handles indexed sets uniformly
    const b = buckets.get(material) ?? { geos: [], cast: false, receive: false }
    b.geos.push(geo)
    b.cast ||= m.castShadow
    b.receive ||= m.receiveShadow
    buckets.set(material, b)
    victims.push(m)
  })
  for (const v of victims) v.removeFromParent()
  for (const [material, b] of buckets) {
    const indexed = b.geos.filter((g) => g.index)
    const plain = b.geos.filter((g) => !g.index)
    for (const set of [indexed, plain]) {
      if (set.length === 0) continue
      const merged = mergeGeometries(set, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = b.cast
      mesh.receiveShadow = b.receive
      mesh.frustumCulled = false
      root.add(mesh)
    }
  }
}
