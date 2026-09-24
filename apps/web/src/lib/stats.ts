/** p50 / p95 / max of a list of milliseconds (nearest rank), zeros when empty. */
export function latencyStatsOf(values: number[]): { p50: number; p95: number; max: number } {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
  return { p50: q(0.5), p95: q(0.95), max: sorted.at(-1) ?? 0 }
}
