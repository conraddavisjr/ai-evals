import type { CafeEvent, RunConfig, RunConfigInput, RunMetrics, Scenario } from '@cafe/protocol'

export interface RunRow {
  id: string
  status: 'pending' | 'running' | 'finished' | 'failed' | 'cancelled'
  config: RunConfig
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  createdAt: number
  active: boolean
}

export interface ModelsInfo {
  allowLive: boolean
  presets: Record<string, string[]>
  personas: string[]
  providersConfigured: Record<string, boolean>
  defaults: RunConfig
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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

export const api = {
  health: () => json<{ ok: boolean; allowLive: boolean }>('/api/health'),
  scenarios: () => json<Scenario[]>('/api/scenarios'),
  models: () => json<ModelsInfo>('/api/models'),
  runs: () => json<RunRow[]>('/api/runs'),
  run: (id: string) => json<RunRow>(`/api/runs/${id}`),
  startRun: (config: RunConfigInput) =>
    json<{ runId: string }>('/api/runs', { method: 'POST', body: JSON.stringify(config) }),
  cancelRun: (id: string) =>
    json<{ cancelled: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  deleteRun: (id: string) => json<{ deleted: boolean }>(`/api/runs/${id}`, { method: 'DELETE' }),
  events: (id: string, afterSeq = -1) =>
    json<CafeEvent[]>(`/api/runs/${id}/events?afterSeq=${afterSeq}`),
  metrics: (id: string) => json<RunMetrics>(`/api/runs/${id}/metrics`),
  judgements: (id: string) =>
    json<Array<{ txId: string; blindedTranscript: string; judgeSpec: string }>>(
      `/api/runs/${id}/judgements`,
    ),
}

/** Tail a run over SSE. Returns a closer. */
export function openStream(
  runId: string,
  handlers: {
    onEvent: (e: CafeEvent) => void
    onDone: (status: string) => void
    onError?: (err: unknown) => void
  },
  afterSeq = -1,
): () => void {
  const es = new EventSource(`/api/runs/${runId}/stream?afterSeq=${afterSeq}`)
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
}
