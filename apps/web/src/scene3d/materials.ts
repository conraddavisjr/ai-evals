import * as THREE from 'three'

/**
 * One painterly material system. Toon shading with a few bands gives the
 * hand-painted gradient look; emissive variants glow under bloom. Materials are
 * cached by key so the whole scene shares a handful of programs.
 */
let gradient: THREE.DataTexture | null = null
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient
  // Broad, blended value steps support the painted vertex gradients.
  const data = new Uint8Array([100, 135, 170, 210, 239, 255])
  gradient = new THREE.DataTexture(data, 6, 1, THREE.RedFormat)
  gradient.minFilter = THREE.LinearFilter
  gradient.magFilter = THREE.LinearFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

const cache = new Map<string, THREE.Material>()

export interface MatOptions {
  emissive?: string | undefined
  emissiveIntensity?: number | undefined
  opacity?: number | undefined
  vertexColors?: boolean | undefined
}

export function mat(color: string, opts: MatOptions = {}): THREE.MeshToonMaterial {
  const key = JSON.stringify([color, opts])
  const hit = cache.get(key)
  if (hit) return hit as THREE.MeshToonMaterial
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: gradientMap(),
    ...(opts.emissive
      ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 1 }
      : {}),
    ...(opts.opacity !== undefined ? { transparent: true, opacity: opts.opacity } : {}),
    ...(opts.vertexColors ? { vertexColors: true } : {}),
  })
  cache.set(key, m)
  return m
}

/** Glass and glowing panes: basic material so they read as light sources under bloom. */
export function glow(color: string, intensity = 1): THREE.MeshBasicMaterial {
  const key = `glow:${color}:${intensity}`
  const hit = cache.get(key)
  if (hit) return hit as THREE.MeshBasicMaterial
  const c = new THREE.Color(color).multiplyScalar(intensity)
  const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
  cache.set(key, m)
  return m
}

/** Soft radial sprite texture for flames, steam and selection glows. */
let softDot: THREE.CanvasTexture | null = null
export function softDotTexture(): THREE.CanvasTexture {
  if (softDot) return softDot
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  softDot = new THREE.CanvasTexture(c)
  return softDot
}

/** Text baked onto a canvas for signs. */
export function textTexture(
  text: string,
  opts: { font?: string; color?: string; bg?: string; w?: number; h?: number } = {},
): THREE.CanvasTexture {
  const w = opts.w ?? 256
  const h = opts.h ?? 96
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2d')
  ctx.fillStyle = opts.bg ?? 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = opts.color ?? '#2b1d16'
  ctx.font = opts.font ?? `bold ${Math.round(h * 0.5)}px "Lilita One", "Nunito", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 2)
  const t = new THREE.CanvasTexture(c)
  t.anisotropy = 4
  return t
}
