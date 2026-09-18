import type { CafeEvent, RunConfigInput, RunMetrics, Scenario } from '@cafe/protocol'
import type { HarnessClient, ModelsInfo, RunRow, StreamHandlers } from './types.js'

/** The Stardust server's REST + SSE API, mounted under `baseUrl` (default: same origin). */
export function createHttpHarness(baseUrl = ''): HarnessClient {
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
