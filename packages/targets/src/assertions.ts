import type { Assertion, EvalCase } from './config.js'
import type { TargetResult } from './http-target.js'
import { query } from './jsonpath.js'

/** One pass/fail line in a case's report. */
export interface Check {
  kind: 'outcome' | 'reason' | 'assertion' | 'contract' | 'judge'
  label: string
  ok: boolean
  /** Why it failed, or what it saw. */
  detail: string
}

/**
 * The document assertion paths read: the mapped fields at the top, the app's
 * own response under `raw`. `$.output[*].title`, `$.raw.guard_issues`.
 */
export function resultDocument(r: TargetResult): Record<string, unknown> {
  return {
    outcome: r.outcome,
    latencyMs: r.latencyMs,
    reason: r.reason,
    detail: r.detail,
    output: r.output,
    steps: r.steps,
    raw: r.raw,
  }
}

/** "850ms", "2.4s", "1m 12s". */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** The whole request's time, or the sum of one reported step's times (null when not reported). */
export function latencyOf(r: TargetResult, step?: string): number | null {
  if (!step) return r.latencyMs
  const hits = r.steps.filter((s) => s.name === step && s.ms !== null)
  return hits.length ? hits.reduce((sum, s) => sum + (s.ms ?? 0), 0) : null
}

const show = (v: unknown, max = 120): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === undefined) return 'nothing'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function includes(hay: unknown, needle: unknown): boolean {
  if (typeof hay === 'string' && typeof needle === 'string')
    return hay.toLowerCase().includes(needle.toLowerCase())
  if (Array.isArray(hay)) return hay.some((x) => equal(x, needle) || includes(x, needle))
  return false
}

/** Every string inside a value, for regex checks across nested output. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

export function describeAssertion(a: Assertion): string {
  if (a.note) return a.note
  switch (a.type) {
    case 'jsonPath':
      return `${a.path} ${a.op}${a.value === undefined ? '' : ` ${show(a.value, 40)}`}`
    case 'count':
      return `count(${a.path}) ${[a.min !== undefined ? `>= ${a.min}` : '', a.max !== undefined ? `<= ${a.max}` : ''].filter(Boolean).join(' and ')}`
    case 'regexAbsent':
      return `no /${a.pattern}/ in ${a.path}`
    case 'regexPresent':
      return `/${a.pattern}/ in ${a.path}`
    case 'stepPresent':
      return `step "${a.name}" ran`
    case 'latency':
      return `${a.step ? `step "${a.step}"` : 'the whole request'} within ${fmtMs(a.maxMs)}`
  }
}

export function runAssertion(a: Assertion, r: TargetResult): Check {
  const doc = resultDocument(r)
  const label = describeAssertion(a)
  const check = (ok: boolean, detail: string): Check => ({ kind: 'assertion', label, ok, detail })
  if (a.when && !a.when.includes(r.outcome)) return check(true, `skipped: outcome ${r.outcome}`)
  switch (a.type) {
    case 'jsonPath': {
      const got = query(doc, a.path)
      switch (a.op) {
        case 'exists':
          return check(got.length > 0, got.length ? `found ${show(got[0])}` : 'no match')
        case 'absent':
          return check(got.length === 0, got.length ? `found ${show(got[0])}` : 'no match')
        case 'equals':
          return check(got.length > 0 && got.every((v) => equal(v, a.value)), `saw ${show(got)}`)
        case 'notEquals':
          return check(
            got.every((v) => !equal(v, a.value)),
            `saw ${show(got)}`,
          )
        case 'includes':
          return check(
            got.some((v) => includes(v, a.value)),
            `saw ${show(got)}`,
          )
        case 'excludes':
          return check(!got.some((v) => includes(v, a.value)), `saw ${show(got)}`)
        case 'lte':
        case 'gte': {
          const bad = got.filter(
            (v) =>
              typeof v !== 'number' || (a.op === 'lte' ? v > Number(a.value) : v < Number(a.value)),
          )
          return check(
            got.length > 0 && bad.length === 0,
            bad.length ? `saw ${show(bad)}` : got.length ? `saw ${show(got)}` : 'no match',
          )
        }
      }
      break
    }
    case 'count': {
      const got = query(doc, a.path)
      // A path that selects one array counts its elements; otherwise count the matches.
      const n = got.length === 1 && Array.isArray(got[0]) ? got[0].length : got.length
      const ok = (a.min === undefined || n >= a.min) && (a.max === undefined || n <= a.max)
      return check(ok, `counted ${n}`)
    }
    case 'regexAbsent':
    case 'regexPresent': {
      let re: RegExp
      try {
        re = new RegExp(a.pattern, a.flags)
      } catch (err) {
        // loadPack rejects bad patterns first; a case built another way still fails cleanly
        return check(false, `not a valid regex: ${(err as Error).message}`)
      }
      const hits = strings(query(doc, a.path)).flatMap((s) => {
        const m = re.exec(s)
        return m ? [m[0]] : []
      })
      return a.type === 'regexAbsent'
        ? check(hits.length === 0, hits.length ? `matched ${show(hits[0], 60)}` : 'no match')
        : check(hits.length > 0, hits.length ? `matched ${show(hits[0], 60)}` : 'no match')
    }
    case 'stepPresent': {
      const names = r.steps.map((s) => s.name)
      return check(names.includes(a.name), `steps: ${names.join(', ') || 'none reported'}`)
    }
    case 'latency': {
      const ms = latencyOf(r, a.step)
      if (ms === null) return check(false, `step "${a.step}" was not reported`)
      return check(ms <= a.maxMs, `took ${fmtMs(ms)}`)
    }
  }
  return check(false, 'unknown assertion')
}

/** Everything decided without a model: outcome, reason, contract, then the case's assertions. */
export function deterministicChecks(c: EvalCase, r: TargetResult): Check[] {
  const checks: Check[] = []
  const want = c.expect.outcome
  if (want) {
    const allowed = Array.isArray(want) ? want : [want]
    checks.push({
      kind: 'outcome',
      label: `outcome ${allowed.join(' or ')}`,
      ok: allowed.includes(r.outcome),
      detail: `got ${r.outcome}${r.reason ? ` (${r.reason})` : ''}${r.detail ? `: ${show(r.detail, 160)}` : ''}`,
    })
  }
  if (c.expect.reason && r.outcome !== 'served')
    checks.push({
      kind: 'reason',
      label: `reason ${c.expect.reason.join(' or ')}`,
      ok: r.reason !== null && c.expect.reason.includes(r.reason),
      detail: `got ${r.reason ?? 'no reason'}`,
    })
  if (r.contractErrors.length)
    checks.push({
      kind: 'contract',
      label: 'response matches the contract',
      ok: false,
      detail: r.contractErrors.join('; '),
    })
  for (const a of c.expect.assertions) checks.push(runAssertion(a, r))
  return checks
}
