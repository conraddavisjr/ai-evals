import type { CafeStore } from '@cafe/db'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { InheritAttributesProcessor } from './inherit-processor.js'
import { PgSpanExporter } from './pg-exporter.js'

export interface Tracing {
  /** Wait until every finished span is in Postgres (and handed to OTLP, if configured). */
  flush(): Promise<void>
  shutdown(): Promise<void>
}

let current: Tracing | null = null

/**
 * Registers the OpenTelemetry SDK for this process: spans go to the `spans` table
 * as they close (so live charts see them), and to an OTLP collector when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. Call once at boot; without it every span in
 * the codebase is a no-op.
 */
export function initTracing(opts: {
  store: CafeStore
  otlpUrl?: string | undefined
  serviceName?: string
}): Tracing {
  const pg = new PgSpanExporter(opts.store)
  const processors: SpanProcessor[] = [
    new InheritAttributesProcessor(),
    new SimpleSpanProcessor(pg),
  ]
  let otlp: BatchSpanProcessor | null = null
  if (opts.otlpUrl) {
    const url = opts.otlpUrl.endsWith('/v1/traces')
      ? opts.otlpUrl
      : `${opts.otlpUrl.replace(/\/$/, '')}/v1/traces`
    otlp = new BatchSpanProcessor(new OTLPTraceExporter({ url }))
    processors.push(otlp)
  }
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': opts.serviceName ?? 'stardust-cafe' }),
    spanProcessors: processors,
  })
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  trace.setGlobalTracerProvider(provider)
  current = {
    flush: async () => {
      await pg.flush()
      await otlp?.forceFlush()
    },
    shutdown: async () => {
      await provider.shutdown()
      trace.disable()
      context.disable()
      current = null
    },
  }
  return current
}

/** Flush spans written so far; a no-op when tracing was never initialised. */
export function flushTracing(): Promise<void> {
  return current?.flush() ?? Promise.resolve()
}
