import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { CafeScene3D, type SceneCallbacks } from './CafeScene3D.js'
import { COLS, ROWS } from './layout.js'

export interface Game {
  scene: CafeScene3D
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  /** Advance one frame manually (used when the tab is hidden and rAF is paused). */
  step(now: number): void
  destroy(): void
  /** Last frame's CPU time in ms. */
  frameMs: number
}

const CAMERA_PITCH = THREE.MathUtils.degToRad(55)
const CAMERA_YAW = THREE.MathUtils.degToRad(9)

/**
 * Renderer, camera and post stack for the painterly look: ACES tone mapping,
 * soft shadows from a low cool key light, warm point lights on the lamps, and a
 * bloom pass that only catches emissives.
 */
export function createGame(
  parent: HTMLElement,
  player: TimelinePlayer,
  callbacks: SceneCallbacks,
): Game {
  parent.classList.add('scene-mount')
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.3
  renderer.outputColorSpace = THREE.SRGBColorSpace
  parent.appendChild(renderer.domElement)

  const scene = new CafeScene3D(player, callbacks, parent)
  scene.scene.background = new THREE.Color('#0e2231')
  scene.scene.fog = new THREE.FogExp2('#0e2231', 0.012)

  // lights: cool dusk ambient from the sky, warm bounce from the ground, a low key light for shadows
  const hemi = new THREE.HemisphereLight('#6fb6d8', '#4a3550', 1.7)
  scene.scene.add(hemi)
  const key = new THREE.DirectionalLight('#cfe3f0', 1.9)
  key.position.set(-8, 14, 10)
  key.target.position.set(COLS / 2, 0, ROWS / 2)
  key.castShadow = true
  key.shadow.mapSize.set(1536, 1536)
  key.shadow.bias = -0.0008
  key.shadow.normalBias = 0.02
  const sc = key.shadow.camera
  sc.left = -14
  sc.right = 14
  sc.top = 12
  sc.bottom = -12
  sc.near = 1
  sc.far = 50
  scene.scene.add(key, key.target)
  const lane = new THREE.PointLight('#ffd7a0', 9, 10, 1.6)
  lane.position.set(COLS * 0.35, 3.4, 3.4)
  scene.scene.add(lane)
  const fill = new THREE.DirectionalLight('#ffb27a', 0.45)
  fill.position.set(12, 6, 16)
  scene.scene.add(fill)

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 120)
  const target = new THREE.Vector3(COLS / 2, 0.4, ROWS / 2)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene.scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.88)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  /** Place the camera on its fixed angle at a distance that fits the whole square. */
  function fit(width: number, height: number) {
    camera.aspect = width / height
    let dist = 24
    const corners = [
      new THREE.Vector3(-0.5, 0, -1.5),
      new THREE.Vector3(COLS + 0.5, 0, -1.5),
      new THREE.Vector3(-0.5, 0, ROWS + 0.5),
      new THREE.Vector3(COLS + 0.5, 0, ROWS + 0.5),
      new THREE.Vector3(COLS / 2, 4.5, -1.5),
      new THREE.Vector3(COLS / 2, 0, ROWS + 1.5),
    ]
    for (let iter = 0; iter < 6; iter++) {
      place(dist)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      let maxNdc = 0
      for (const c of corners) {
        const p = c.clone().project(camera)
        maxNdc = Math.max(maxNdc, Math.abs(p.x), Math.abs(p.y))
      }
      dist *= maxNdc / 0.985
    }
    place(dist)
    camera.updateProjectionMatrix()
    // centre the square in the frame: measure the NDC box and pan the target to cancel the offset
    for (let iter = 0; iter < 3; iter++) {
      camera.updateMatrixWorld()
      let minX = 1
      let maxX = -1
      let minY = 1
      let maxY = -1
      for (const c of corners) {
        const p = c.clone().project(camera)
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      const halfW = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      target.addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH)
      place(dist)
    }
    camera.updateProjectionMatrix()
  }
  function place(dist: number) {
    const dir = new THREE.Vector3(
      Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
      Math.sin(CAMERA_PITCH),
      Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
    )
    camera.position.copy(target).addScaledVector(dir, dist)
    camera.lookAt(target)
  }

  let width = 1
  let height = 1
  function resize() {
    const rect = parent.getBoundingClientRect()
    width = Math.max(320, Math.floor(rect.width))
    height = Math.max(200, Math.floor(rect.height))
    renderer.setSize(width, height, false)
    renderer.domElement.style.width = `${width}px`
    renderer.domElement.style.height = `${height}px`
    composer.setSize(width, height)
    bloom.setSize(width / 4, height / 4)
    fit(width, height)
  }
  resize()
  const ro = new ResizeObserver(() => resize())
  ro.observe(parent)

  // picking: click a character to select it, empty ground to clear
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const onPointerDown = (ev: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(scene.characterRoots, true)
    const id = hits.find((h) => h.object.userData.characterId)?.object.userData.characterId as
      | string
      | undefined
    scene.select(id ?? null)
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(scene.characterRoots, true)
    const id = hit.find((h) => h.object.userData.characterId)?.object.userData.characterId as
      | string
      | undefined
    renderer.domElement.style.cursor = id ? 'pointer' : 'default'
    scene.setHover(id ?? null)
  })

  let last: number | null = null
  let raf = 0
  const game: Game = {
    scene,
    renderer,
    camera,
    frameMs: 0,
    step(now: number) {
      const t0 = performance.now()
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000)
      last = now
      scene.update(dt, now)
      composer.render()
      scene.overlay.update(camera, width, height)
      game.frameMs = performance.now() - t0
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      scene.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      parent.classList.remove('scene-mount')
    },
  }
  const loop = (now: number) => {
    game.step(now)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return game
}
