import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Character } from './Character.js'
import type { Facing } from './layout.js'
import { LOOKS } from './palette.js'

// Only the canvas-backed shadow texture needs a browser; keep the real rig and geometry.
vi.mock('./materials.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./materials.js')>()),
  softDotTexture: () => new THREE.Texture(),
}))

function part(character: Character, name: string): THREE.Mesh {
  const mesh = character.root.getObjectByName(name)
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`Missing character part: ${name}`)
  return mesh
}

function bounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (!box) throw new Error('Missing geometry bounds')
  return box.clone().applyMatrix4(mesh.matrixWorld)
}

function expectConnected(character: Character) {
  character.root.updateMatrixWorld(true)
  const torso = bounds(part(character, 'torso'))
  const neck = bounds(part(character, 'neck'))
  const head = bounds(character.head)
  expect(neck.intersectsBox(torso), 'neck meets torso').toBe(true)
  expect(neck.intersectsBox(head), 'head meets neck').toBe(true)
  for (const side of ['left', 'right']) {
    const arm = bounds(part(character, `${side}-arm`))
    const hand = bounds(part(character, `${side}-hand`))
    const leg = bounds(part(character, `${side}-leg`))
    expect(arm.intersectsBox(torso), `${side} shoulder meets torso`).toBe(true)
    expect(hand.intersectsBox(arm), `${side} hand meets sleeve`).toBe(true)
    expect(leg.intersectsBox(torso), `${side} hip meets torso`).toBe(true)
  }
}

describe('character joint alignment', () => {
  it.each(Object.keys(LOOKS))('%s stays connected at rest in every facing', (sprite) => {
    const character = new Character(
      'alignment',
      'Alignment',
      sprite,
      { x: 3, y: 3, face: 'down' },
      true,
    )
    for (const face of ['up', 'down', 'left', 'right'] as const) {
      character.snapTo({ x: 3, y: 3, face })
      expectConnected(character)
    }
    const apron = character.root.getObjectByName('apron')
    const pocket = character.root.getObjectByName('apron-pocket')
    if (apron instanceof THREE.Mesh && pocket instanceof THREE.Mesh) {
      expect(bounds(apron).intersectsBox(bounds(part(character, 'torso')))).toBe(true)
      expect(bounds(pocket).intersectsBox(bounds(apron))).toBe(true)
    }
    character.dispose()
  })

  it('keeps the joints attached during a full walk cycle and resets the pose on seek', async () => {
    const start = { x: 3, y: 3, face: 'down' as Facing }
    const character = new Character('walking', 'Walking', 'cashier_a', start, true)
    const destination = { x: 9, y: 3, face: 'left' as Facing }
    const arrived = character.moveTo(destination, 3)
    let swung = false
    for (let frame = 0; frame < 150; frame++) {
      character.update(1 / 60)
      expectConnected(character)
      swung ||= Math.abs(part(character, 'left-arm').rotation.x) > 0.45
    }
    await arrived
    expect(swung).toBe(true)
    expect(character.walking).toBe(false)
    expect(character.tile).toEqual(destination)
    character.snapTo(start)
    expectConnected(character)
    expect(part(character, 'left-arm').rotation.x).toBe(0)
    expect(part(character, 'right-leg').rotation.x).toBe(0)
    character.dispose()
  })
})
