import * as THREE from 'three'
import { at, block, sphere } from './builders.js'
import { streamMaterial } from './effects.js'
import { P } from './palette.js'

/** Height stays outside the station grid, so every existing route remains level. */
export function landscape() {
  const group = new THREE.Group()
  group.add(at(block(21.6, 1.3, 14.1, P.stoneDark, { radius: 0.25 }), 10, 6.4, -0.85))
  for (let row = 0; row < 3; row++) {
    for (let z = 0; z < 14; z++) {
      group.add(
        at(
          block(0.5, 0.42, 0.92, row % 2 ? '#3e6069' : '#496c74'),
          -0.8,
          z + (row % 2) * 0.35,
          -1.2 + row * 0.4,
        ),
      )
    }
  }
  const water = streamMaterial()
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 15.5), water)
  stream.rotation.x = -Math.PI / 2
  stream.position.set(-1.65, -0.72, 5.7)
  stream.userData.dynamic = true
  group.add(stream)
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), water)
  fall.position.set(-1.65, -1.2, 13.48)
  fall.userData.dynamic = true
  group.add(fall)
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), water)
  pool.rotation.x = -Math.PI / 2
  pool.position.set(-1.65, -1.55, 13.65)
  pool.userData.dynamic = true
  group.add(pool)
  for (let i = 0; i < 18; i++) {
    const rock = sphere(0.35 + (i % 3) * 0.08, i % 3 ? P.stoneDark : P.mossDark, { segments: 7 })
    rock.scale.set(0.9, 1.3, 1.4)
    group.add(at(rock, -2.55 - Math.sin(i * 2) * 0.13, i * 0.82 - 1.3, -0.68))
  }
  for (let i = 0; i < 7; i++) {
    const foam = sphere(0.16, '#b1e3d9', { segments: 7 })
    foam.scale.set(1.5, 0.25, 0.75)
    group.add(at(foam, -2.25 + i * 0.2, 13.7 + Math.sin(i) * 0.18, -1.5))
  }
  group.add(at(block(14, 0.6, 3, P.stoneDark), 7.1, -0.65, 0.2))
  for (let i = 0; i < 3; i++)
    group.add(at(block(2 - i * 0.16, 0.18, 0.38, P.stone), 14.5, 0.4 - i * 0.32, 0.08 + i * 0.18))
  group.add(at(block(5, 0.2, 0.8, P.timberDark), 10.6, 0.8, 3.35))
  for (let i = 0; i < 12; i++)
    group.add(at(block(0.09, 0.65, 0.09, P.timber), 8.2 + i * 0.43, 1.12, 3.75))
  group.add(at(block(5.1, 0.13, 0.16, P.plank), 10.6, 1.12, 4.08))
  // Chunky retaining stones give the island an exposed, weight-bearing front edge.
  for (let row = 0; row < 2; row++) {
    for (let x = 0; x < 21; x++) {
      group.add(
        at(
          block(0.94, 0.4, 0.38, row ? '#526f7a' : '#3d5768'),
          x + (row % 2) * 0.32,
          13.36,
          -0.83 + row * 0.4,
        ),
      )
    }
  }
  // Soft clustered foliage frames the architecture without entering customer paths.
  for (const [x, z] of [
    [-1.3, -1.9],
    [20, -0.3],
  ] as const) {
    group.add(at(block(0.35, 2.5, 0.38, P.timberDark), x, z, 0.8))
    for (let i = 0; i < 7; i++) {
      const crown = sphere(
        0.65 + (i % 3) * 0.12,
        i % 3 === 0 ? '#718764' : i % 3 === 1 ? '#497568' : '#45636b',
        { segments: 8 },
      )
      crown.scale.set(1, 0.8, 1)
      group.add(
        at(crown, x + Math.sin(i * 2.4) * 0.72, z + Math.cos(i * 2.4) * 0.65, 2.3 + (i % 3) * 0.45),
      )
    }
  }
  return { group, water }
}
