import type { CafeStore } from '@cafe/db'
import { SCENARIOS } from '@cafe/evals'
import { createMcpServer, Gateway, ROLE_SCOPES } from '@cafe/mcp-gateway'
import { PERSONAS } from '@cafe/models'
import { type Role, RunConfig } from '@cafe/protocol'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import type { RunManager } from './run-manager.js'

export interface HttpDeps {
  store: CafeStore
  runs: RunManager
  allowLive: boolean
}

/** Model presets offered in the UI. Anything matching the ModelSpec grammar is accepted too. */
export const MODEL_PRESETS = {
  mock: [
    'mock:cashier',
    'mock:cashier-naive',
    'mock:barista',
    'mock:barista-forgetful',
    'mock:manager',
    'mock:judge',
  ],
  anthropic: [
    'anthropic/claude-haiku-4-5-20251001',
    'anthropic/claude-sonnet-5',
    'anthropic/claude-opus-5',
  ],
  openai: ['openai/gpt-5-nano', 'openai/gpt-5-mini', 'openai/gpt-5'],
  google: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
  gateway: [
    'gateway:typesafe-ai/jev',
    'gateway:anthropic/claude-haiku-4-5',
    'gateway:openai/gpt-5-mini',
    'gateway:google/gemini-2.5-flash-lite',
  ],
  ollama: ['ollama/llama3.3', 'ollama/qwen3'],
}

export function createApp(deps: HttpDeps) {
  const { store, runs } = deps
  const app = new Hono()
  app.use('*', cors())

  app.get('/api/health', (c) => c.json({ ok: true, allowLive: deps.allowLive }))

  app.get('/api/scenarios', (c) => c.json(SCENARIOS))

  app.get('/api/models', (c) =>
    c.json({
      allowLive: deps.allowLive,
      presets: MODEL_PRESETS,
      personas: Object.keys(PERSONAS),
      providersConfigured: {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        google: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
        gateway: Boolean(process.env.AI_GATEWAY_API_KEY),
        ollama: Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL),
      },
      defaults: RunConfig.parse({
        scenarioIds: SCENARIOS.map((s) => s.id),
        roles: {
          cashier: 'mock:cashier',
          barista: 'mock:barista',
          manager: 'mock:manager',
          judge: 'mock:judge',
        },
      }),
    }),
  )

  app.get('/api/runs', async (c) => {
    const rows = await store.runs.list(100)
    return c.json(rows.map((r) => ({ ...r, active: runs.isActive(r.id) })))
  })

  app.post('/api/runs', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be JSON' }, 400)
    }
    try {
      const { runId } = await runs.start(body as Parameters<RunManager['start']>[0])
      return c.json({ runId }, 201)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/api/runs/:id', async (c) => {
    const run = await store.runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    return c.json({ ...run, active: runs.isActive(run.id) })
  })

  app.post('/api/runs/:id/cancel', (c) => c.json({ cancelled: runs.cancel(c.req.param('id')) }))

  app.delete('/api/runs/:id', async (c) => {
    const id = c.req.param('id')
    if (runs.isActive(id)) return c.json({ error: 'run is active; cancel it first' }, 409)
    await store.runs.delete(id)
    return c.json({ deleted: true })
  })

  app.get('/api/runs/:id/events', async (c) => {
    const afterSeq = Number(c.req.query('afterSeq') ?? -1)
    return c.json(await runs.events(c.req.param('id'), afterSeq))
  })

  /** Live tail: replays everything so far, then streams. Ends with `done` when the run is over. */
  app.get('/api/runs/:id/stream', async (c) => {
    const id = c.req.param('id')
    const run = await store.runs.get(id)
    if (!run) return c.json({ error: 'not found' }, 404)
    return streamSSE(c, async (stream) => {
      let lastSeq = Number(c.req.query('afterSeq') ?? -1)
      const send = async (e: { seq: number }) => {
        lastSeq = e.seq
        await stream.writeSSE({ event: 'cafe', id: String(e.seq), data: JSON.stringify(e) })
      }
      for (const e of await runs.events(id, lastSeq)) await send(e)
      if (!runs.isActive(id)) {
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ status: run.status }) })
        return
      }
      const queue: Array<{ seq: number }> = []
      let notify: (() => void) | null = null
      const off = runs.subscribe(id, (e) => {
        if (e.seq <= lastSeq) return
        queue.push(e)
        notify?.()
      })
      let closed = false
      stream.onAbort(() => {
        closed = true
        off?.()
        notify?.()
      })
      const done = runs.whenDone(id)
      let finished = false
      void done?.finally(() => {
        finished = true
        notify?.()
      })
      while (!closed) {
        while (queue.length) {
          const e = queue.shift()
          if (e) await send(e)
        }
        if (finished) {
          // drain anything emitted during shutdown, then close
          for (const e of await runs.events(id, lastSeq)) await send(e)
          const final = await store.runs.get(id)
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ status: final?.status ?? 'finished' }),
          })
          break
        }
        await new Promise<void>((r) => {
          notify = r
          setTimeout(r, 15_000) // heartbeat
        })
        notify = null
        if (!closed) await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
      off?.()
    })
  })

  app.get('/api/runs/:id/metrics', async (c) => {
    const m = await store.metrics.get(c.req.param('id'))
    if (!m) return c.json({ error: 'metrics not ready' }, 404)
    return c.json(m)
  })
  app.get('/api/runs/:id/orders', async (c) =>
    c.json(await store.orders.listByRun(c.req.param('id'))),
  )
  app.get('/api/runs/:id/reviews', async (c) =>
    c.json(await store.reviews.forRun(c.req.param('id'))),
  )
  app.get('/api/runs/:id/judgements', async (c) =>
    c.json(await store.judgements.forRun(c.req.param('id'))),
  )
  app.get('/api/runs/:id/usage', async (c) => c.json(await store.usage.forRun(c.req.param('id'))))
  app.get('/api/runs/:id/incidents', async (c) =>
    c.json(await store.incidents.forRun(c.req.param('id'))),
  )
  app.get('/api/runs/:id/inventory', async (c) =>
    c.json(await store.inventory.list(c.req.param('id'))),
  )

  /**
   * Real MCP over streamable HTTP, one endpoint per role and run, e.g.
   *   POST /mcp/<runId>/barista
   * Point an MCP client at it and it sees exactly the barista's tool slice.
   */
  app.all('/mcp/:runId/:role', async (c) => {
    const role = c.req.param('role') as Role
    if (!(role in ROLE_SCOPES) || role === 'customer' || role === 'judge')
      return c.json({ error: 'role must be cashier, barista, or manager' }, 400)
    const runId = c.req.param('runId')
    const run = await store.runs.get(runId)
    if (!run) return c.json({ error: 'run not found' }, 404)
    const events: unknown[] = []
    const gateway = new Gateway({ store, emit: (e) => events.push(e) })
    const cap = gateway.capability({ agentId: `external-${role}`, role, runId })
    const server = createMcpServer(gateway, cap)
    const transport = new WebStandardStreamableHTTPServerTransport({})
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  return app
}
