import type { CafeStore, SpanInsert } from '@cafe/db'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

const hrToMs = ([s, ns]: [number, number]) => s * 1000 + ns / 1e6
/** Epoch columns are bigint; keep sub-ms precision only in duration_ms. */
const epochMs = (hr: [number, number]) => Math.round(hrToMs(hr))

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

/** One finished span to one row. Kept pure so the mapping is testable without a database. */
export function spanToRow(span: ReadableSpan): SpanInsert {
  const a = span.attributes as Record<string, unknown>
  const ctx = span.spanContext()
  const startT = epochMs(span.startTime)
  const endT = epochMs(span.endTime)
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    runId: str(a['cafe.run_id']),
    suiteId: str(a['cafe.suite_id']),
    txId: str(a['cafe.tx_id']),
    name: span.name,
    kind: str(a['cafe.kind']) ?? 'other',
    role: str(a['cafe.role']),
    agentId: str(a['cafe.agent_id']),
    modelSpec: str(a['cafe.model_spec']),
    tool: str(a['cafe.tool']),
    startT,
    endT,
    durationMs: Math.max(0, hrToMs(span.endTime) - hrToMs(span.startTime)),
    status: span.status.code === 2 ? 'error' : span.status.code === 1 ? 'ok' : 'unset',
    errorKind: str(a['cafe.error_kind']),
    costUsd: num(a['cafe.cost_usd']),
    inputTokens: num(a['cafe.input_tokens']),
    outputTokens: num(a['cafe.output_tokens']),
    attributes: a,
  }
}

/**
 * Writes spans to the `spans` table as they finish. Inserts are chained so they
 * land in order and `flush()` can wait for everything in flight (the same pattern
 * as the EventBus persistence chain).
 */
export class PgSpanExporter implements SpanExporter {
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly store: CafeStore) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const rows = spans.map(spanToRow)
    this.chain = this.chain
      .then(() => this.store.spans.appendMany(rows))
      .then(
        () => resultCallback({ code: ExportResultCode.SUCCESS }),
        (err: unknown) => {
          console.warn('[spans] insert failed:', err instanceof Error ? err.message : err)
          resultCallback({ code: ExportResultCode.FAILED, error: err as Error })
        },
      )
  }

  /** Resolves once every span exported so far is in the database. */
  flush(): Promise<void> {
    return this.chain
  }
  forceFlush(): Promise<void> {
    return this.chain
  }
  shutdown(): Promise<void> {
    return this.chain
  }
}
