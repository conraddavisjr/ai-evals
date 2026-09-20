/** Small linear/log/band scales; enough for the panel charts without a library. */

export interface Scale {
  (v: number): number
  domain: [number, number]
  range: [number, number]
  ticks(count?: number): number[]
}

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  const f = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale
  f.domain = domain
  f.range = range
  f.ticks = (count = 5) => niceTicks(d0, d1, count)
  return f
}

/** log10 scale for latencies that span ms to minutes; domain must be positive. */
export function log(domain: [number, number], range: [number, number]): Scale {
  const lo = Math.max(1e-3, domain[0])
  const hi = Math.max(lo * 10, domain[1])
  const l0 = Math.log10(lo)
  const l1 = Math.log10(hi)
  const [r0, r1] = range
  const f = ((v: number) =>
    r0 + ((Math.log10(Math.max(lo, v)) - l0) / (l1 - l0)) * (r1 - r0)) as Scale
  f.domain = [lo, hi]
  f.range = range
  f.ticks = () => {
    const out: number[] = []
    for (let p = Math.floor(l0); p <= Math.ceil(l1); p++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** p
        if (v >= lo && v <= hi) out.push(v)
      }
    }
    return out
  }
  return f
}

export function band(items: number, range: [number, number], padding = 0.25) {
  const [r0, r1] = range
  const step = (r1 - r0) / Math.max(1, items)
  const width = step * (1 - padding)
  return {
    step,
    width,
    at: (i: number) => r0 + i * step + (step - width) / 2,
    center: (i: number) => r0 + i * step + step / 2,
  }
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    out.push(Number(v.toFixed(10)))
  return out
}

export const extent = (values: number[], fallback: [number, number] = [0, 1]): [number, number] =>
  values.length ? [Math.min(...values), Math.max(...values)] : fallback

/** Ticks whose formatted labels are distinct, so integer axes never read "0 0 1 1". */
export function labelledTicks(
  ticks: number[],
  format: (v: number) => string,
): Array<{ v: number; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ v: number; label: string }> = []
  for (const v of ticks) {
    const label = format(v)
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ v, label })
  }
  return out
}
