import type {
  CafeEvent,
  RunConfigInput,
  RunMetrics,
  RunTelemetry,
  Scenario,
  SpanSummary,
} from '@cafe/protocol'
import type {
  ExperimentClient,
  HarnessClient,
  ModelsInfo,
  RunRow,
  StreamHandlers,
} from './types.js'

/** The Stardust server's REST + SSE API, mounted under `baseUrl` (default: same origin). */
export function createHttpHarness(baseUrl = ''): HarnessClient & ExperimentClient {
  const url = (path: string) => `${baseUrl}${path}`
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url(path), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) msg = body.error
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    return (await res.json()) as T
  }

  return {
    scenarios: () => json<Scenario[]>('/api/scenarios'),
    models: () => json<ModelsInfo>('/api/models'),
    runs: () => json<RunRow[]>('/api/runs'),
    run: (id) => json<RunRow>(`/api/runs/${id}`),
    startRun: (config: RunConfigInput) =>
      json<{ runId: string }>('/api/runs', { method: 'POST', body: JSON.stringify(config) }),
    cancelRun: (id) => json<{ cancelled: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
    deleteRun: (id) => json<{ deleted: boolean }>(`/api/runs/${id}`, { method: 'DELETE' }),
    events: (id, afterSeq = -1) => json<CafeEvent[]>(`/api/runs/${id}/events?afterSeq=${afterSeq}`),
    metrics: (id) => json<RunMetrics>(`/api/runs/${id}/metrics`),
    judgements: (id) => json(`/api/runs/${id}/judgements`),
    telemetry: (id) => json<RunTelemetry>(`/api/runs/${id}/telemetry`),
    datasets: () => json('/api/datasets'),
    dataset: (id) => json(`/api/datasets/${id}`),
    createDataset: (input) =>
      json('/api/datasets', { method: 'POST', body: JSON.stringify(input) }),
    updateDataset: (id, patch) =>
      json(`/api/datasets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteDataset: (id) => json(`/api/datasets/${id}`, { method: 'DELETE' }),
    addItem: (id, item) =>
      json(`/api/datasets/${id}/items`, { method: 'POST', body: JSON.stringify(item) }),
    updateItem: (id, itemId, item) =>
      json(`/api/datasets/${id}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(item) }),
    deleteItem: (id, itemId) => json(`/api/datasets/${id}/items/${itemId}`, { method: 'DELETE' }),
    reorderItems: (id, ids) =>
      json(`/api/datasets/${id}/items/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
    tools: () => json('/api/tools'),
    spans: (id, q = {}) => {
      const p = new URLSearchParams()
      if (q.txId) p.set('txId', q.txId)
      if (q.kinds?.length) p.set('kind', q.kinds.join(','))
      if (q.limit) p.set('limit', String(q.limit))
      if (q.offset) p.set('offset', String(q.offset))
      const qs = p.toString()
      return json<SpanSummary[]>(`/api/runs/${id}/spans${qs ? `?${qs}` : ''}`)
    },
    stream(runId: string, handlers: StreamHandlers, afterSeq = -1): () => void {
      const es = new EventSource(url(`/api/runs/${runId}/stream?afterSeq=${afterSeq}`))
      es.addEventListener('cafe', (ev) =>
        handlers.onEvent(JSON.parse((ev as MessageEvent).data) as CafeEvent),
      )
      es.addEventListener('done', (ev) => {
        const { status } = JSON.parse((ev as MessageEvent).data) as { status: string }
        handlers.onDone(status)
        es.close()
      })
      es.onerror = (err) => handlers.onError?.(err)
      return () => es.close()
    },
  }
}
