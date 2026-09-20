import * as THREE from 'three'
import { block, cylinder, sphere } from './builders.js'
import { FACING_YAW, type Facing, route, type Spot, worldX, worldZ } from './layout.js'
import { glow, mat, softDotTexture } from './materials.js'
import { type Look, lookFor } from './palette.js'

const WALK_SPEED = 3.2 // tiles per second at 1x

/**
 * A chunky low-poly villager. Parts are separate meshes so limbs can swing.
 * Movement is a waypoint queue advanced every frame (no tween library needed),
 * which also makes it trivial to snap on seek.
 */
export class Character {
  readonly root = new THREE.Group()
  readonly head: THREE.Mesh
  readonly headAnchor = new THREE.Object3D()
  private readonly legL: THREE.Mesh
  private readonly legR: THREE.Mesh
  private readonly armL: THREE.Mesh
  private readonly armR: THREE.Mesh
  private readonly body: THREE.Group
  private readonly selectRing: THREE.Mesh
  private readonly waypoints: Array<{ x: number; z: number }> = []
  private onArrive: (() => void) | null = null
  private targetFace: Facing = 'down'
  private phase = 0
  tile: Spot
  speed = 1
  readonly look: Look

  constructor(
    readonly id: string,
    readonly label: string,
    sprite: string,
    spot: Spot,
    readonly isStaff: boolean,
  ) {
    this.tile = { ...spot }
    this.look = lookFor(sprite)
    const L = this.look
    this.body = new THREE.Group()

    // Blocks have centered geometry. Place their centers relative to the hips,
    // and keep a small overlap at each joint so bevels cannot expose a gap.
    const hipY = 0.55
    const torsoHeight = 0.55
    const torsoY = hipY + torsoHeight / 2 - 0.025
    const shoulderY = hipY + torsoHeight - 0.1
    const neckY = hipY + torsoHeight
    const torso = block(0.5, torsoHeight, 0.32, L.shirt, { radius: 0.12 })
    torso.name = 'torso'
    torso.position.y = torsoY
    this.body.add(torso)
    const neck = cylinder(0.1, 0.12, 0.18, L.skin, 10)
    neck.name = 'neck'
    neck.position.y = neckY
    this.body.add(neck)
    if (L.apron) {
      const apron = block(0.42, 0.5, 0.06, L.apron, { radius: 0.05 })
      apron.name = 'apron'
      apron.position.set(0, torsoY - 0.02, 0.17)
      this.body.add(apron)
    }
    this.legL = block(0.18, 0.5, 0.2, L.pants, { radius: 0.05 })
    this.legR = block(0.18, 0.5, 0.2, L.pants, { radius: 0.05 })
    this.legL.name = 'left-leg'
    this.legR.name = 'right-leg'
    this.legL.position.set(-0.13, hipY, 0)
    this.legR.position.set(0.13, hipY, 0)
    this.legL.geometry.translate(0, -0.25, 0)
    this.legR.geometry.translate(0, -0.25, 0)
    this.body.add(this.legL, this.legR)
    this.armL = block(0.14, 0.45, 0.16, L.shirt, { radius: 0.05 })
    this.armR = block(0.14, 0.45, 0.16, L.shirt, { radius: 0.05 })
    this.armL.name = 'left-arm'
    this.armR.name = 'right-arm'
    this.armL.geometry.translate(0, -0.2, 0)
    this.armR.geometry.translate(0, -0.2, 0)
    this.armL.position.set(-0.28, shoulderY, 0)
    this.armR.position.set(0.28, shoulderY, 0)
    this.body.add(this.armL, this.armR)
    for (const [arm, side] of [
      [this.armL, 'left'],
      [this.armR, 'right'],
    ] as const) {
      const hand = sphere(0.09, L.skin, { segments: 8 })
      hand.name = `${side}-hand`
      hand.position.set(0, -0.45, 0)
      arm.add(hand)
    }
    this.head = sphere(0.3, L.skin, { segments: 14 })
    this.head.name = 'head'
    this.head.position.y = neckY + 0.3
    const hair = sphere(0.31, L.hair, { segments: 12 })
    hair.scale.set(1, 0.75, 1)
    hair.position.y = 0.09
    this.head.add(hair)
    // Swept fringe, ears and a nose read as a face at the overview scale.
    for (const side of [-1, 1]) {
      const ear = sphere(0.075, L.skin, { segments: 8 })
      ear.position.set(side * 0.29, -0.015, 0)
      this.head.add(ear)
    }
    const nose = sphere(0.055, L.skin, { segments: 8 })
    nose.position.set(0, -0.03, 0.3)
    this.head.add(nose)
    const fringe = sphere(0.18, L.hair, { segments: 8 })
    fringe.scale.set(1.2, 0.5, 0.65)
    fringe.position.set(-0.11, 0.2, 0.2)
    fringe.rotation.z = -0.3
    this.head.add(fringe)
    if (sprite === 'cashier_a' || sprite === 'customer_f') {
      const bun = sphere(0.19, L.hair, { segments: 9 })
      bun.position.set(0.2, 0.19, -0.16)
      this.head.add(bun)
    }
    if (L.hat) {
      const cap = cylinder(0.3, 0.32, 0.14, L.hat, 14)
      cap.position.y = 0.22
      this.head.add(cap)
      const brim = block(0.44, 0.05, 0.25, L.hat)
      brim.position.set(0, 0.24, 0.24)
      this.head.add(brim)
    }
    if (sprite === 'judge' || sprite === 'manager') {
      for (const side of [-1, 1]) {
        const glasses = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.014, 5, 10), mat('#d6c395'))
        glasses.position.set(side * 0.1, 0.02, 0.29)
        this.head.add(glasses)
      }
    }
    if (L.apron) {
      const pocket = block(0.2, 0.16, 0.04, L.shirt, { radius: 0.03 })
      pocket.name = 'apron-pocket'
      pocket.position.set(0.06, torsoY - 0.06, 0.21)
      this.body.add(pocket)
    }
    // eyes
    for (const dx of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), mat('#1a1a1a'))
      eye.position.set(dx, 0.02, 0.27)
      this.head.add(eye)
    }
    this.body.add(this.head)
    this.headAnchor.position.y = this.head.position.y + 0.5
    this.body.add(this.headAnchor)
    this.body.scale.setScalar(1.15)
    this.root.add(this.body)

    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 28), glow('#ffd27a', 1.5))
    this.selectRing.rotation.x = -Math.PI / 2
    this.selectRing.position.y = 0.03
    this.selectRing.visible = false
    this.root.add(this.selectRing)
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 16),
      new THREE.MeshBasicMaterial({
        map: softDotTexture(),
        color: '#000000',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    this.root.add(shadow)

    this.root.traverse((o) => {
      o.userData.characterId = id
    })
    this.snapTo(spot)
  }

  snapTo(spot: Spot) {
    this.waypoints.length = 0
    this.onArrive = null
    this.tile = { ...spot }
    this.root.position.set(worldX(spot.x), 0, worldZ(spot.y))
    this.face(spot.face)
    this.body.rotation.y = FACING_YAW[spot.face]
    this.restPose()
  }

  face(dir: Facing) {
    this.targetFace = dir
  }

  moveTo(spot: Spot, aisleRow: number, speed = 1): Promise<void> {
    this.speed = speed
    const from: Spot = { x: this.tile.x, y: this.tile.y, face: this.targetFace }
    const pts = route(from, spot, aisleRow)
    this.waypoints.length = 0
    for (const p of pts) this.waypoints.push({ x: worldX(p.x), z: worldZ(p.y) })
    this.tile = { ...spot }
    this.targetFace = spot.face
    return new Promise((resolve) => {
      this.onArrive = resolve
      if (this.waypoints.length === 0) this.arrive()
    })
  }

  get walking() {
    return this.waypoints.length > 0
  }

  setSelected(on: boolean) {
    this.selectRing.visible = on
  }

  private arrive() {
    const cb = this.onArrive
    this.onArrive = null
    this.restPose()
    cb?.()
  }

  private restPose() {
    this.legL.rotation.x = 0
    this.legR.rotation.x = 0
    this.armL.rotation.x = 0
    this.armR.rotation.x = 0
    this.body.position.y = 0
  }

  update(dt: number) {
    const target = this.waypoints[0]
    if (target) {
      const dx = target.x - this.root.position.x
      const dz = target.z - this.root.position.z
      const dist = Math.hypot(dx, dz)
      const step = WALK_SPEED * this.speed * dt
      if (dist <= step) {
        this.root.position.set(target.x, 0, target.z)
        this.waypoints.shift()
        if (this.waypoints.length === 0) this.arrive()
      } else {
        this.root.position.x += (dx / dist) * step
        this.root.position.z += (dz / dist) * step
        this.body.rotation.y = Math.atan2(dx, dz)
        this.phase += dt * 10 * this.speed
        const s = Math.sin(this.phase)
        this.legL.rotation.x = s * 0.7
        this.legR.rotation.x = -s * 0.7
        this.armL.rotation.x = -s * 0.5
        this.armR.rotation.x = s * 0.5
        this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.06
      }
    } else {
      // ease the facing towards the station's direction when idle
      const want = FACING_YAW[this.targetFace]
      let diff = want - this.body.rotation.y
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      this.body.rotation.y += diff * Math.min(1, dt * 8)
    }
  }

  dispose() {
    this.root.removeFromParent()
  }
}
