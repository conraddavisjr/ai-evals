import type { z } from 'zod'
import type { EvalCase, HttpTargetConfig, Outcome } from './config.js'
import { first } from './jsonpath.js'
import { fillTemplate } from './template.js'

/** One phase the app reports it went through (classify, drafting, repairing ...). */
export interface TargetStep {
  name: string
  ms: number | null
  model: string | null
}

/** What any target hands back for one case, whatever kind of app answered. */
export interface TargetResult {
  outcome: Outcome
  /** Machine code: the app's own (`off_topic`, `capped`) or the harness's (`timeout`, `http_500`). */
  reason: string | null
  /** A human sentence from the app, when it gave one. */
  detail: string | null
  output: unknown
  steps: TargetStep[]
  usage: { inputTokens: number | null; outputTokens: number | null; usd: number | null } | null
  model: string | null
  latencyMs: number
  httpStatus: number | null
  /** The parsed response body, for assertions that look past the mapped fields. */
  raw: unknown
  /** Contract violations: the response did not match the pack's response schema. */
  contractErrors: string[]
}

export interface Target {
  kind: 'http'
  describe(): string
  /** The body the case would send, for --dry-run and for the report. */
  request(c: EvalCase, ctx: InvokeContext): unknown
  invoke(c: EvalCase, ctx: InvokeContext): Promise<TargetResult>
}

export interface InvokeContext {
  runId: string
  attempt: number
  signal?: AbortSignal | undefined
}

type Fetch = typeof fetch

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

function steps(v: unknown): TargetStep[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((s) => {
    if (typeof s === 'string') return [{ name: s, ms: null, model: null }]
    if (!s || typeof s !== 'object') return []
    const o = s as Record<string, unknown>
    const name = str(o.name) ?? str(o.phase)
    if (!name) return []
    return [{ name, ms: num(o.ms) ?? num(o.latency_ms) ?? num(o.latencyMs), model: str(o.model) }]
  })
}

function failed(
  reason: string,
  detail: string,
  latencyMs: number,
  status: number | null,
  raw: unknown = null,
): TargetResult {
  return {
    outcome: 'failed',
    reason,
    detail,
    output: null,
    steps: [],
    usage: null,
    model: null,
    latencyMs,
    httpStatus: status,
    raw,
    contractErrors: [],
  }
}

/**
 * Posts each case to a URL and maps the JSON back through the pack's
 * responseMap. Transport problems become `failed` with a harness reason, never
 * a thrown error, so one bad case never stops a run.
 */
export function httpTarget(
  cfg: HttpTargetConfig,
  opts: { fetch?: Fetch; responseSchema?: z.ZodType | null } = {},
): Target {
  const doFetch = opts.fetch ?? fetch
  const schema = opts.responseSchema ?? null
  const ctxOf = (c: EvalCase, ctx: InvokeContext) => ({
    input: c.input,
    case: { id: c.id, title: c.title, tags: c.tags },
    // firstAttempt lets a pack keep side effects (saved output) to one repeat of a case.
    run: { id: ctx.runId, attempt: ctx.attempt, firstAttempt: ctx.attempt === 1 },
  })
  return {
    kind: 'http',
    describe: () => `${cfg.method} ${cfg.url}`,
    request: (c, ctx) => fillTemplate(cfg.bodyTemplate, ctxOf(c, ctx)),
    async invoke(c, ctx) {
      const body = fillTemplate(cfg.bodyTemplate, ctxOf(c, ctx))
      const started = performance.now()
      const elapsed = () => Math.round(performance.now() - started)
      const timeout = AbortSignal.timeout(cfg.timeoutMs)
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout
      let res: Response
      try {
        res = await doFetch(cfg.url, {
          method: cfg.method,
          headers: { 'content-type': 'application/json', ...cfg.headers },
          body: JSON.stringify(body),
          signal,
        })
      } catch (err) {
        if (timeout.aborted)
          return failed('timeout', `No answer within ${cfg.timeoutMs} ms`, elapsed(), null)
        const cause = (err as { cause?: { code?: string } }).cause?.code
        return failed(
          'unreachable',
          `${cfg.url}: ${cause ?? (err as Error).message}`,
          elapsed(),
          null,
        )
      }
      let text = ''
      try {
        text = await res.text()
      } catch (err) {
        if (timeout.aborted)
          return failed('timeout', `No answer within ${cfg.timeoutMs} ms`, elapsed(), res.status)
        return failed('unreachable', (err as Error).message, elapsed(), res.status)
      }
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      if (!res.ok)
        return failed(
          `http_${res.status}`,
          str((json as { error?: unknown } | null)?.error) ??
            (text.slice(0, 200) || res.statusText),
          elapsed(),
          res.status,
          json,
        )
      if (json === null || typeof json !== 'object')
        return failed(
          'invalid_json',
          `Response was not a JSON object: ${text.slice(0, 200)}`,
          elapsed(),
          res.status,
        )

      const map = cfg.responseMap
      const rawOutcome = first(json, map.outcome)
      const outcome = typeof rawOutcome === 'string' ? map.outcomeMap[rawOutcome] : undefined
      const contractErrors: string[] = []
      if (schema) {
        const check = schema.safeParse(json)
        if (!check.success)
          for (const issue of check.error.issues.slice(0, 8))
            contractErrors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`)
      }
      const at = (path: string | undefined) => (path ? first(json, path) : undefined)
      const usd = num(at(map.usd))
      const inputTokens = num(at(map.inputTokens))
      const outputTokens = num(at(map.outputTokens))
      return {
        outcome: outcome ?? 'failed',
        reason: outcome ? str(at(map.reason)) : 'unmapped_outcome',
        detail: outcome
          ? str(at(map.detail))
          : `Outcome ${JSON.stringify(rawOutcome)} is not in the pack's outcomeMap`,
        output: map.output ? (at(map.output) ?? null) : json,
        steps: steps(at(map.steps)),
        usage:
          usd === null && inputTokens === null && outputTokens === null
            ? null
            : { inputTokens, outputTokens, usd },
        model: str(at(map.model)),
        latencyMs: elapsed(),
        httpStatus: res.status,
        raw: json,
        contractErrors,
      }
    },
  }
}
