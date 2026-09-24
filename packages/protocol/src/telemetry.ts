import { z } from 'zod'

/**
 * What the telemetry charts read: a per-run aggregate computed from the run's
 * OpenTelemetry spans (plus run metrics for pass/fail). Small enough to poll
 * while a run is live.
 */
export const SpanSummary = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  txId: z.string().nullable(),
  name: z.string(),
  kind: z.string(),
  role: z.string().nullable(),
  agentId: z.string().nullable(),
  modelSpec: z.string().nullable(),
  tool: z.string().nullable(),
  startT: z.number(),
  endT: z.number(),
  durationMs: z.number(),
  status: z.string(),
  errorKind: z.string().nullable(),
  costUsd: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  attributes: z.record(z.string(), z.unknown()),
})
export type SpanSummary = z.infer<typeof SpanSummary>

const Distribution = z.object({
  count: z.number().int(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
  mean: z.number(),
  /** Raw samples for dot strips, capped. */
  samples: z.array(z.number()),
})
export type Distribution = z.infer<typeof Distribution>

export const ErrorLayer = z.enum(['triage', 'agent', 'tool', 'review', 'judge', 'run'])
export type ErrorLayer = z.infer<typeof ErrorLayer>

export const RunTelemetry = z.object({
  runId: z.string(),
  suiteId: z.string().nullable(),
  variant: z.string().nullable(),
  /** Latency per tool across the run. */
  tools: z.array(
    Distribution.extend({
      tool: z.string(),
      errors: z.number().int(),
      byCode: z.record(z.string(), z.number().int()),
    }),
  ),
  /** Model latency per (role, step index): how long each reasoning step takes. */
  steps: z.array(Distribution.extend({ role: z.string(), stepIndex: z.number().int() })),
  /** Cost accumulated visit by visit, in arrival order. */
  costTrajectory: z.array(
    z.object({
      visitIndex: z.number().int(),
      txId: z.string(),
      scenarioId: z.string(),
      byRole: z.record(z.string(), z.number()),
      visitUsd: z.number(),
      cumulativeUsd: z.number(),
    }),
  ),
  costByRole: z.record(z.string(), z.number()),
  errors: z.object({
    total: z.number().int(),
    byLayer: z.record(ErrorLayer, z.number().int()),
    byKind: z.record(z.string(), z.number().int()),
    list: z.array(
      z.object({
        txId: z.string().nullable(),
        scenarioId: z.string().nullable(),
        layer: ErrorLayer,
        tool: z.string().nullable(),
        step: z.number().nullable(),
        role: z.string().nullable(),
        kind: z.string(),
        message: z.string().nullable(),
        t: z.number(),
      }),
    ),
  }),
  /** One row per visit (one golden item): the per-iteration view. */
  items: z.array(
    z.object({
      visitIndex: z.number().int(),
      txId: z.string(),
      scenarioId: z.string(),
      outcome: z.string().nullable(),
      taskSuccess: z.boolean().nullable(),
      durationMs: z.number(),
      costUsd: z.number(),
      toolCalls: z.number().int(),
      toolErrors: z.number().int(),
      agentErrors: z.number().int(),
      judgeCorrect: z.number().nullable(),
      reviewVerdict: z.string().nullable(),
    }),
  ),
  /** Spans seen so far; a live run keeps growing. */
  spanCount: z.number().int(),
})
export type RunTelemetry = z.infer<typeof RunTelemetry>
