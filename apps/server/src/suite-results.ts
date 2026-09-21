import type { CafeStore } from '@cafe/db'
import { runTelemetry } from '@cafe/evals'
import type {
  RunMetrics,
  RunTelemetry,
  SuiteDetail,
  SuiteMatrixRow,
  SuiteVariantResult,
} from '@cafe/protocol'
import { shortScenarioId, variantKey } from '@cafe/protocol'
import { getDataset } from './scenarios.js'

export interface SuiteMetricsView {
  suite: SuiteDetail
  variants: Array<SuiteVariantResult<RunMetrics>>
  matrix: SuiteMatrixRow[]
}

export interface SuiteTelemetryView {
  suiteId: string
  variants: Array<SuiteVariantResult<RunTelemetry>>
  /** Errors per golden item per variant: where things go wrong, and for whom. */
  errorMatrix: Array<{ scenarioId: string; cells: Record<string, number> }>
}

/** Side-by-side run metrics for every variant and the item x variant pass/fail grid. */
export async function suiteMetrics(
  store: CafeStore,
  detail: SuiteDetail,
): Promise<SuiteMetricsView> {
  const variants: Array<SuiteVariantResult<RunMetrics>> = []
  for (const r of detail.runs) {
    const metrics = r.runId ? await store.metrics.get(r.runId) : null
    variants.push({
      key: variantKey(r.variant, r.repeat),
      variant: r.variant,
      repeat: r.repeat,
      runId: r.runId,
      status: r.status,
      result: metrics,
    })
  }
  const dataset = await getDataset(store, detail.config.datasetId)
  const ids = detail.config.itemIds ?? dataset?.items.map((i) => i.id) ?? []
  const titles = new Map(dataset?.items.map((i) => [i.id, i.title]) ?? [])
  const matrix: SuiteMatrixRow[] = ids.map((scenarioId) => {
    const cells: SuiteMatrixRow['cells'] = {}
    for (const v of variants) {
      const t = v.result?.perTransaction.find((x) => x.scenarioId === scenarioId)
      cells[v.key] = t
        ? {
            outcome: t.outcome,
            taskSuccess: t.taskSuccess,
            costUsd: t.costUsd,
            durationMs: t.totalMs,
            errors: t.errors,
            judgeCorrect: t.judge?.correct.probability ?? null,
            reviewVerdict: t.review?.verdict ?? null,
          }
        : null
    }
    return { scenarioId, title: titles.get(scenarioId) ?? shortScenarioId(scenarioId), cells }
  })
  return { suite: detail, variants, matrix }
}

/** Every variant run's telemetry aggregate, plus errors per item per variant. */
export async function suiteTelemetry(
  store: CafeStore,
  detail: SuiteDetail,
): Promise<SuiteTelemetryView> {
  const variants: Array<SuiteVariantResult<RunTelemetry>> = []
  for (const r of detail.runs) {
    let result: RunTelemetry | null = null
    if (r.runId) {
      const [spans, metrics] = await Promise.all([
        store.spans.forRun(r.runId, { limit: 20_000 }),
        store.metrics.get(r.runId),
      ])
      result = runTelemetry(r.runId, spans, metrics, {
        suiteId: detail.id,
        variant: variantKey(r.variant, r.repeat),
      })
    }
    variants.push({
      key: variantKey(r.variant, r.repeat),
      variant: r.variant,
      repeat: r.repeat,
      runId: r.runId,
      status: r.status,
      result,
    })
  }
  const ids = new Set<string>()
  for (const v of variants) for (const i of v.result?.items ?? []) ids.add(i.scenarioId)
  const errorMatrix = [...ids].map((scenarioId) => {
    const cells: Record<string, number> = {}
    for (const v of variants) {
      const i = v.result?.items.find((x) => x.scenarioId === scenarioId)
      cells[v.key] = i ? i.toolErrors + i.agentErrors : 0
    }
    return { scenarioId, cells }
  })
  return { suiteId: detail.id, variants, errorMatrix }
}
