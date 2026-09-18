import type { Station } from '@cafe/protocol'
import * as THREE from 'three'
import {
  at,
  awning,
  backBar,
  barrel,
  block,
  brazier,
  chair,
  cobblestones,
  cottage,
  counter,
  crate,
  desk,
  espressoMachine,
  fountain,
  gate,
  grinder,
  lampPost,
  mergeStatic,
  pastryCase,
  planter,
  register,
  stoneWall,
  table,
  ticketRail,
} from './builders.js'
import { Steam, waterMaterial } from './effects.js'
import { landscape } from './landscape.js'
import { COLS, ROWS, worldX, worldZ } from './layout.js'
import { mat, textTexture } from './materials.js'
import { P } from './palette.js'

export interface World {
  group: THREE.Group
  steam: Partial<Record<Station, Steam>>
  water: THREE.ShaderMaterial
  /** World position of the ticket rail's left end and its length. */
  rail: { x: number; y: number; z: number; length: number }
  update(dt: number, t: number): void
}

/**
 * The village square. Everything is placed on the same tile grid the layout uses,
 * so stations, slots and routes from the pixel version still hold.
 */
export function buildWorld(): World {
  const g = new THREE.Group()
  g.add(cobblestones(COLS, ROWS))
  const land = landscape()
  g.add(land.group)
  // the world beyond the plaza: dark mossy ground so the square does not float in the void
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat('#1f3f3b'))
  ground.rotation.x = -Math.PI / 2
  ground.position.set(COLS / 2, -1.65, ROWS / 2)
  ground.receiveShadow = true
  g.add(ground)

  // ----- the kiosk: back bar (row 2), staff lane (row 3), front counter (row 4), cols 1..13
  g.add(at(backBar(13), worldX(7) - 0.5, worldZ(2) - 0.15))
  g.add(at(counter(13, 0.9), worldX(7) - 0.5, worldZ(4)))
  for (const x of [3, 6]) {
    const r = register()
    r.scale.setScalar(1.45)
    g.add(at(r, worldX(x), worldZ(4), 0.97))
  }
  // back-bar working surface for the machines
  for (const [label, x, width] of [
    ['PAY HERE', 5, 3.1],
    ['PICKUP', 11.5, 2.2],
  ] as const) {
    g.add(at(block(width + 0.14, 0.5, 0.1, P.brass), x, 5.03, 0.52))
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.39),
      new THREE.MeshBasicMaterial({
        map: textTexture(label, { color: '#e5dbb6', bg: '#1d4148', w: 512, h: 96 }),
      }),
    )
    g.add(at(sign, x, 5.09, 0.52))
  }
  const backTop = counter(13, 0.8)
  g.add(at(backTop, worldX(7) - 0.5, worldZ(2) + 0.25))
  for (const x of [4, 7]) {
    const m = espressoMachine()
    m.scale.setScalar(1.3)
    g.add(at(m, worldX(x), worldZ(2) + 0.25, 0.97))
  }
  g.add(at(grinder(), worldX(2), worldZ(2) + 0.25, 0.97))
  g.add(at(pastryCase(), worldX(12), worldZ(2) + 0.25, 0.97))
  g.add(at(ticketRail(4.4), worldX(11), worldZ(3.5), 0))
  // canopy over the back bar only: a deeper one would hide the staff lane from this camera pitch
  g.add(at(awning(13.6, 1.5, 2.7, 3.0), worldX(7) - 0.5, worldZ(1.6)))

  // ----- office annex (cols 15..18, rows 2..3)
  g.add(at(cottage(4.2, 2.2, 2.4, { windows: 2 }), worldX(16.5), worldZ(1) - 0.2))
  g.add(at(desk(), worldX(16.5), worldZ(2) + 0.2))
  g.add(at(awning(4.4, 1.3, 2.5, 2.8), worldX(16.5), worldZ(1.6)))

  // ----- north cottage row behind the kiosk gives the square its back wall
  g.add(at(cottage(7, 2.4, 3.7, { windows: 3 }), worldX(4), worldZ(0) - 1.0))
  g.add(at(cottage(5, 2.4, 3.8, { windows: 2 }), worldX(10.5), worldZ(0) - 1.0))

  // ----- east cottage with the door, and the entrance gate at the south-east
  g.add(
    at(
      cottage(2.6, 4.5, 2.6, { windows: 1, door: true }),
      worldX(19.6),
      worldZ(7.5),
      0,
      -Math.PI / 2,
    ),
  )
  g.add(at(gate(), worldX(17), worldZ(12.2), 0, 0))
  g.add(at(stoneWall(6), worldX(3.5), worldZ(12.3)))
  g.add(at(stoneWall(6), worldX(11), worldZ(12.3)))
  g.add(at(stoneWall(7), worldX(0) - 0.1, worldZ(8.5), 0, Math.PI / 2))

  // ----- plaza furniture
  const f = fountain()
  g.add(at(f.group, worldX(9.5), worldZ(8.5)))
  const water = waterMaterial()
  f.water.material = water

  g.add(at(table(), worldX(14), worldZ(8)))
  g.add(at(chair(), worldX(13), worldZ(8), 0, Math.PI / 2))
  g.add(at(chair(), worldX(15), worldZ(8), 0, -Math.PI / 2))
  g.add(at(table(), worldX(5), worldZ(10.5)))
  g.add(at(chair(), worldX(4), worldZ(10.5), 0, Math.PI / 2))
  g.add(at(chair(), worldX(6), worldZ(10.5), 0, -Math.PI / 2))

  g.add(at(planter(), worldX(1), worldZ(5)))
  g.add(at(planter(), worldX(18), worldZ(5.2)))
  g.add(at(planter(), worldX(1), worldZ(11)))
  g.add(at(crate(), worldX(14.2), worldZ(11.2), 0, 0.3))
  g.add(at(crate(), worldX(14.8), worldZ(11.6), 0, -0.2))
  g.add(at(barrel(), worldX(13.4), worldZ(11.5)))
  g.add(at(barrel(), worldX(18.2), worldZ(10)))

  g.add(at(lampPost(), worldX(1.5), worldZ(6.5)))
  g.add(at(lampPost(), worldX(12.5), worldZ(6.2)))
  g.add(at(lampPost(), worldX(17.5), worldZ(7)))
  g.add(at(lampPost(), worldX(8), worldZ(11.3)))
  g.add(at(brazier(), worldX(15.6), worldZ(11.4)))

  // steam and the water disc stay dynamic; everything else bakes into a few meshes
  f.water.userData.dynamic = true
  mergeStatic(g)

  const steam: Partial<Record<Station, Steam>> = {}
  for (const [station, x] of [
    ['espresso_1', 4],
    ['espresso_2', 7],
  ] as const) {
    const s = new Steam()
    s.points.position.set(worldX(x), 2.2, worldZ(2) + 0.25)
    g.add(s.points)
    steam[station] = s
  }

  return {
    group: g,
    steam,
    water,
    rail: { x: worldX(11) - 2.2, y: 2.45, z: worldZ(3.5), length: 4.4 },
    update(dt, t) {
      const u = water.uniforms.uTime
      if (u) u.value = t
      if (land.water.uniforms.uTime) land.water.uniforms.uTime.value = t
      for (const s of Object.values(steam)) s?.update(dt)
    },
  }
}
