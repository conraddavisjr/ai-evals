import { z } from 'zod'
import { Role } from './domain.js'
import { JudgeAnswers, ReviewIssue, ReviewVerdict } from './events.js'

export const LatencyStats = z.object({
  count: z.number().int(),
  p50: z.number(),
  p95: z.number(),
  max: z.number(),
  mean: z.number(),
})
export type LatencyStats = z.infer<typeof LatencyStats>

export const TransactionMetrics = z.object({
  txId: z.string(),
  scenarioId: z.string(),
  orderId: z.string().nullable(),
  outcome: z.enum(['served', 'refused', 'abandoned', 'failed']).nullable(),
  /** Ground truth: did the final order match the scenario expectation (or refuse when it should)? */
  taskSuccess: z.boolean(),
  taskSuccessReasons: z.array(z.string()),
  toolPrecision: z.number().min(0).max(1).nullable(),
  toolRecall: z.number().min(0).max(1).nullable(),
  scopeViolations: z.number().int(),
  errors: z.number().int(),
  retries: z.number().int(),
  stepsByRole: z.record(Role, z.number().int()),
  totalMs: z.number().nullable(),
  beatMs: z.record(z.string(), z.number()),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  judge: JudgeAnswers.nullable(),
  judgeLatencyMs: z.number().nullable(),
  review: z.object({ verdict: ReviewVerdict, issues: z.array(ReviewIssue) }).nullable(),
})
export type TransactionMetrics = z.infer<typeof TransactionMetrics>

export const RunMetrics = z.object({
  runId: z.string(),
  transactions: z.number().int(),
  taskSuccessRate: z.number().min(0).max(1),
  failureRate: z.number().min(0).max(1),
  refusalAccuracy: z.number().min(0).max(1).nullable(),
  meanToolPrecision: z.number().nullable(),
  meanToolRecall: z.number().nullable(),
  scopeViolations: z.number().int(),
  endToEnd: LatencyStats,
  latencyByRole: z.record(Role, LatencyStats),
  beatLatency: z.record(z.string(), LatencyStats),
  meanStepsByRole: z.record(Role, z.number()),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  judgeMeans: z
    .object({
      correct: z.number(),
      refusalAppropriate: z.number(),
      helpfulness: z.number(),
      tone: z.number(),
      toolUseQuality: z.number(),
    })
    .nullable(),
  /** How many visits the manager marked ok / concern / escalate; null when the review was off. */
  reviewCounts: z.record(ReviewVerdict, z.number().int()).nullable(),
  perTransaction: z.array(TransactionMetrics),
})
export type RunMetrics = z.infer<typeof RunMetrics>
