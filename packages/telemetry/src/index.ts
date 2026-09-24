import {
  type Attributes,
  type Context,
  context,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api'

/**
 * The cafe's OpenTelemetry conventions. Every package that does work worth timing
 * (agent turns, tool calls, judge, review, triage, visits, runs, suites) starts its
 * spans through here so attribute names and parenting stay consistent. Without an
 * SDK registered (tests, the CLI by default) all of this is a no-op.
 */
export const TRACER_NAME = 'stardust-cafe'

/** Attribute keys. Kept flat and prefixed so they survive any OTLP backend's UI. */
export const ATTR = {
  SUITE_ID: 'cafe.suite_id',
  VARIANT: 'cafe.variant',
  RUN_ID: 'cafe.run_id',
  TX_ID: 'cafe.tx_id',
  SCENARIO_ID: 'cafe.scenario_id',
  VISIT_INDEX: 'cafe.visit_index',
  /** run | visit | triage | agent.turn | step | tool | review | judge | suite */
  KIND: 'cafe.kind',
  ROLE: 'cafe.role',
  AGENT_ID: 'cafe.agent_id',
  MODEL_SPEC: 'cafe.model_spec',
  STEP: 'cafe.step',
  TOOL: 'cafe.tool',
  TOOL_SCOPE: 'cafe.tool_scope',
  TOOL_OK: 'cafe.tool_ok',
  TOOL_CODE: 'cafe.tool_code',
  CALL_ID: 'cafe.call_id',
  OUTCOME: 'cafe.outcome',
  ERROR_KIND: 'cafe.error_kind',
  INPUT_TOKENS: 'cafe.input_tokens',
  OUTPUT_TOKENS: 'cafe.output_tokens',
  COST_USD: 'cafe.cost_usd',
  LATENCY_MS: 'cafe.latency_ms',
} as const

export type SpanKindName =
  | 'suite'
  | 'run'
  | 'visit'
  | 'triage'
  | 'gate'
  | 'agent.turn'
  | 'step'
  | 'tool'
  | 'review'
  | 'judge'

export function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}

/** The context to start children under: an explicit parent span wins over the ambient one. */
export function contextFor(parent?: Span | Context | null): Context {
  if (!parent) return context.active()
  if (isContext(parent)) return parent
  return trace.setSpan(context.active(), parent)
}

function isContext(x: Span | Context): x is Context {
  return typeof (x as Context).getValue === 'function' && !('spanContext' in x)
}

/** Start a span of a given kind under `parent`; the caller ends it. */
export function startSpan(
  kind: SpanKindName,
  name: string,
  attrs: Attributes = {},
  parent?: Span | Context | null,
): Span {
  return tracer().startSpan(
    name,
    { attributes: { [ATTR.KIND]: kind, ...attrs } },
    contextFor(parent),
  )
}

/**
 * Run `fn` inside a span. The span is the active context while `fn` runs, so
 * anything that starts a span underneath (a tool call inside an agent step) nests
 * correctly without threading spans by hand. Errors mark the span and re-throw.
 */
export async function withSpan<T>(
  kind: SpanKindName,
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
  parent?: Span | Context | null,
): Promise<T> {
  const span = startSpan(kind, name, attrs, parent)
  try {
    return await context.with(trace.setSpan(contextFor(parent), span), () => fn(span))
  } catch (err) {
    recordError(span, err)
    throw err
  } finally {
    span.end()
  }
}

/** Run `fn` with `span` as the active span, without ending it. */
export function inSpan<T>(span: Span, fn: () => T): T {
  return context.with(trace.setSpan(context.active(), span), fn)
}

export function recordError(span: Span, err: unknown, kind?: string): void {
  const message = err instanceof Error ? err.message : String(err)
  span.setStatus({ code: SpanStatusCode.ERROR, message })
  if (kind) span.setAttribute(ATTR.ERROR_KIND, kind)
  if (err instanceof Error) span.recordException(err)
}

export function markOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK })
}

export { type Context, context, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
