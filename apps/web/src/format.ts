export const fmtMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
export const fmtDelta = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? '' : `+${fmtMs(ms)}`
export const fmtUsd = (usd: number): string =>
  usd === 0 ? '$0' : usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`
export const fmtCents = (c: number): string => `$${(c / 100).toFixed(2)}`
export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`
export const shortModel = (spec: string): string =>
  spec.replace(/^gateway:/, 'gw:').replace(/-\d{8}$/, '')
