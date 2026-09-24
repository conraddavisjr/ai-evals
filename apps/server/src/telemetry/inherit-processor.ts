import type { Context } from '@opentelemetry/api'
import { trace } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'

/** Attributes every descendant should carry so a span row can be queried without walking the tree. */
const INHERITED = [
  'cafe.suite_id',
  'cafe.variant',
  'cafe.run_id',
  'cafe.tx_id',
  'cafe.scenario_id',
] as const

/**
 * Copies the cafe's scoping attributes from the parent span onto a child at start,
 * unless the child set its own. Parents in this process are SDK spans, so their
 * attributes are readable.
 */
export class InheritAttributesProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const parent = trace.getSpan(parentContext) as
      | (ReadableSpan & { attributes?: unknown })
      | undefined
    const attrs = parent?.attributes as Record<string, unknown> | undefined
    if (!attrs) return
    for (const key of INHERITED) {
      if (span.attributes[key] === undefined && attrs[key] !== undefined)
        span.setAttribute(key, attrs[key] as string)
    }
  }
  onEnd(): void {}
  forceFlush(): Promise<void> {
    return Promise.resolve()
  }
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
