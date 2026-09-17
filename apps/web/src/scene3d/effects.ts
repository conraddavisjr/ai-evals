import * as THREE from 'three'
import { flickers } from './builders.js'
import { softDotTexture } from './materials.js'

/** Painterly water: teal gradient, slow highlight rings, a gentle ripple. No textures. */
export function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#5cc4e8') },
      uDeep: { value: new THREE.Color('#1e6f95') },
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin((uv.x + uv.y) * 14.0 + uTime * 2.0) * 0.015;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.0, 1.0, r));
        float rings = sin(r * 18.0 - uTime * 2.2) * 0.5 + 0.5;
        float band = smoothstep(0.72, 0.8, rings) * (1.0 - r * 0.8);
        col += vec3(0.55, 0.7, 0.75) * band * 0.7;
        float sparkle = step(0.985, fract(sin(dot(floor(vUv * 40.0), vec2(12.9898, 78.233)) + floor(uTime * 3.0)) * 43758.5453));
        col += vec3(0.9) * sparkle * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

/** Rising steam puffs above a machine. */
export class Steam {
  readonly points: THREE.Points
  private readonly positions: Float32Array
  private readonly ages: Float32Array
  private readonly count = 18
  active = false

  constructor() {
    this.positions = new Float32Array(this.count * 3)
    this.ages = new Float32Array(this.count)
    for (let i = 0; i < this.count; i++) this.ages[i] = Math.random()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    const m = new THREE.PointsMaterial({
      map: softDotTexture(),
      color: '#e8f4ff',
      size: 0.45,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.points = new THREE.Points(geo, m)
    this.points.visible = false
  }

  update(dt: number) {
    if (!this.active) {
      this.points.visible = false
      return
    }
    this.points.visible = true
    for (let i = 0; i < this.count; i++) {
      let age = (this.ages[i] ?? 0) + dt * 0.5
      if (age > 1) age -= 1
      this.ages[i] = age
      const spread = 0.12 + age * 0.35
      const angle = i * 2.4 + age * 3
      this.positions[i * 3] = Math.cos(angle) * spread
      this.positions[i * 3 + 1] = age * 1.1
      this.positions[i * 3 + 2] = Math.sin(angle) * spread * 0.6
    }
    this.points.geometry.getAttribute('position').needsUpdate = true
    ;(this.points.material as THREE.PointsMaterial).opacity = 0.5
  }
}

/** Torch and lantern flicker: light intensity and sprite scale wobble together. */
export function updateFlicker(t: number) {
  for (const f of flickers) {
    const n =
      Math.sin(t * 9 + f.phase) * 0.5 +
      Math.sin(t * 23 + f.phase * 1.7) * 0.3 +
      Math.sin(t * 3.1 + f.phase) * 0.2
    f.light.intensity = f.base * (0.9 + n * 0.12)
    const s = 1 + n * 0.08
    if (!f.sprite.userData.baseScale)
      f.sprite.userData.baseScale = [f.sprite.scale.x, f.sprite.scale.y]
    const [bx, by] = f.sprite.userData.baseScale as [number, number]
    f.sprite.scale.set(bx * s, by * s, 1)
  }
}
