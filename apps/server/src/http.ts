import type { CafeStore } from '@cafe/db'
import { DOMAIN_PACKS, domainPack } from '@cafe/domains'
import { runTelemetry } from '@cafe/evals'
import { createMcpServer, Gateway, ROLE_SCOPES } from '@cafe/mcp-gateway'
import { PERSONAS } from '@cafe/models'
import {
  DatasetInput,
  DatasetPatch,
  datasetItemId,
  isBuiltinDatasetId,
  type Role,
  RunConfig,
  type RunConfigInput,
  type Scenario,
  ScenarioInput,
  slugify,
} from '@cafe/protocol'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { BenchRunner } from './bench.js'
import { listOrchestrators } from './orchestrators/index.js'
import type { RecordedEvent, RunManager } from './run-manager.js'
import { getDataset, listDatasets } from './scenarios.js'
import { suiteMetrics, suiteTelemetry } from './suite-results.js'
import { SuiteRunner } from './suite-runner.js'

export interface HttpDeps {
  store: CafeStore
  runs: RunManager
  /** Optional so a minimal harness (runs only) can mount the API without suites. */
  suites?: SuiteRunner | undefined
  bench?: BenchRunner | undefined
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
    'mock:support-rep',
    'mock:support-rep-naive',
    'mock:support-fulfil',
    'mock:support-fulfil-forgetful',
    'mock:support-lead',
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
  const suites = deps.suites ?? new SuiteRunner(store, runs)
  const bench = deps.bench ?? new BenchRunner(store, deps.allowLive)
  const app = new Hono()
  app.use('*', cors())

  app.get('/api/health', (c) => c.json({ ok: true, allowLive: deps.allowLive }))

  /** The business domains a run can play, with the words, dataset and default models of each. */
  app.get('/api/domains', (c) =>
    c.json(
      DOMAIN_PACKS.map((d) => ({
        id: d.id,
        label: d.label,
        blurb: d.blurb,
        vocabulary: d.vocabulary,
        datasetId: d.dataset.id,
        defaultRoles: d.defaultRoles,
        tools: d.tools.map((t) => ({ name: t.name, scope: t.scope, description: t.description })),
        roleScopes: d.roleScopes,
        gateTools: d.gate?.tools ?? [],
        // the exact questions the judge is asked in this domain, for the Inspector's explanations
        judgeQuestions: Object.entries(d.judgeQuestions).map(([id, q]) => ({
          id,
          type: q.type,
          instructions: q.instructions,
          ...('criteria' in q ? { criteria: q.criteria } : {}),
        })),
      })),
    ),
  )

  /**
   * The decision bench: labelled decisions (door guardrail, action gate, judge)
   * asked of several evaluation models side by side, e.g. Jev against LLMs.
   */
  app.post('/api/bench', async (c) => {
    try {
      return c.json(await bench.start(await c.req.json()), 201)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })
  app.get('/api/bench', async (c) => c.json(await bench.list()))
  app.get('/api/bench/:id', async (c) => {
    const b = await bench.get(c.req.param('id'))
    return b ? c.json(b) : c.json({ error: 'bench not found' }, 404)
  })
  app.post('/api/bench/:id/cancel', (c) => c.json({ cancelled: bench.cancel(c.req.param('id')) }))
  app.delete('/api/bench/:id', async (c) => {
    bench.cancel(c.req.param('id'))
    await store.benches.delete(c.req.param('id'))
    return c.json({ deleted: true })
  })

  app.get('/api/scenarios', async (c) => {
    const ds = c.req.query('dataset')
    if (!ds) {
      try {
        return c.json(domainPack(c.req.query('domain')).dataset.scenarios)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 404)
      }
    }
    const d = await getDataset(store, ds)
    return d ? c.json(d.items) : c.json({ error: 'dataset not found' }, 404)
  })

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
        scenarioIds: domainPack('cafe').dataset.scenarios.map((s) => s.id),
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
    const project = c.req.query('project')
    const rows =
      project === undefined
        ? await store.runs.list(100)
        : await store.runs.listForProject(project === 'simulations' ? null : project)
    return c.json(rows.map((r) => ({ ...r, active: runs.isActive(r.id) })))
  })

  /** Every project that has runs; simulated runs (no target) group as "simulations". */
  app.get('/api/projects', async (c) =>
    c.json(
      (await store.runs.projects())
        .map((p) => ({
          id: p.project ?? 'simulations',
          name: p.name ?? 'Simulations',
          simulated: p.project === null,
          runs: p.runs,
          lastAt: p.lastAt,
        }))
        .sort((a, b) => Number(a.simulated) - Number(b.simulated) || b.lastAt - a.lastAt),
    ),
  )

  // ---------- recorded runs: a target run streams in from the CLI or a CI job ----------

  /**
   * When STARDUST_INGEST_TOKEN is set, recorders must send it as a bearer token
   * (a hosted dashboard); unset, the local server accepts recorders on its own.
   */
  const ingestAllowed = (c: { req: { header(name: string): string | undefined } }) => {
    const token = process.env.STARDUST_INGEST_TOKEN
    return !token || c.req.header('authorization') === `Bearer ${token}`
  }

  app.post('/api/ingest/runs', async (c) => {
    if (!ingestAllowed(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await parseBody(
      c,
      z.object({ config: z.unknown(), startedAt: z.number().int().positive().optional() }),
    )
    if ('error' in body) return c.json({ error: body.error }, 400)
    try {
      const { runId } = await runs.startRecorded(
        body.data.config as RunConfigInput,
        body.data.startedAt,
      )
      return c.json({ runId }, 201)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/api/ingest/runs/:id/events', async (c) => {
    if (!ingestAllowed(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await parseBody(
      c,
      z.object({ events: z.array(z.record(z.string(), z.unknown())) }),
    )
    if ('error' in body) return c.json({ error: body.error }, 400)
    try {
      const count = runs.record(c.req.param('id'), body.data.events as unknown as RecordedEvent[])
      return c.json({ count })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/api/ingest/runs/:id/finish', async (c) => {
    if (!ingestAllowed(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await parseBody(
      c,
      z.object({
        status: z.enum(['finished', 'failed', 'cancelled']).default('finished'),
        error: z.string().optional(),
      }),
    )
    if ('error' in body) return c.json({ error: body.error }, 400)
    try {
      await runs.finishRecorded(c.req.param('id'), body.data.status, body.data.error)
      return c.json({ finished: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Parse a JSON body with a zod schema; 400 with a readable message otherwise. */
  const parseBody = async <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return { error: 'Body must be JSON' } as const
    }
    const r = schema.safeParse(raw)
    return r.success ? ({ data: r.data } as const) : ({ error: z.prettifyError(r.error) } as const)
  }

  // ---------- golden datasets ----------

  /** Tool catalogue for the item editor's "expected tools" pickers and the MCP node. */
  app.get('/api/tools', (c) => {
    let pack: ReturnType<typeof domainPack>
    try {
      pack = domainPack(c.req.query('domain'))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404)
    }
    return c.json({
      tools: pack.tools.map((t) => ({
        name: t.name,
        scope: t.scope,
        description: t.description,
        // the parameters as the model sees them: the remote server's schema, or ours from zod
        inputSchema: t.inputJsonSchema ?? z.toJSONSchema(t.input),
      })),
      roleScopes: pack.roleScopes,
    })
  })
  /** Engines that can drive a shift; RunConfig.orchestrator names one. */
  app.get('/api/orchestrators', (c) => c.json(listOrchestrators()))
  app.get('/api/datasets', async (c) => c.json(await listDatasets(store)))
  app.get('/api/datasets/:id', async (c) => {
    const d = await getDataset(store, c.req.param('id'))
    return d ? c.json(d) : c.json({ error: 'dataset not found' }, 404)
  })
  app.post('/api/datasets', async (c) => {
    const p = await parseBody(c, DatasetInput)
    if ('error' in p) return c.json({ error: p.error }, 400)
    const now = Date.now()
    const row = await store.datasets.create({
      name: p.data.name,
      description: p.data.description,
      now,
    })
    const seed: Scenario[] = []
    if (p.data.cloneFrom) {
      const src = await getDataset(store, p.data.cloneFrom)
      if (!src) return c.json({ error: `cloneFrom dataset ${p.data.cloneFrom} not found` }, 400)
      seed.push(...src.items)
    }
    const used = new Set<string>()
    const place = (slug: string) => {
      let s = slug
      for (let n = 2; used.has(s); n++) s = `${slug}-${n}`
      used.add(s)
      return s
    }
    for (const item of seed) {
      const slug = place(item.id.replace(/^ds:[^:]+:/, ''))
      await store.datasets.upsertItem(row.id, { ...item, id: datasetItemId(row.id, slug) }, now)
    }
    for (const input of p.data.items) {
      const { slug: wanted, ...rest } = input
      const slug = place(wanted ?? slugify(rest.title))
      await store.datasets.upsertItem(row.id, { ...rest, id: datasetItemId(row.id, slug) }, now)
    }
    return c.json(await getDataset(store, row.id), 201)
  })
  app.patch('/api/datasets/:id', async (c) => {
    const id = c.req.param('id')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    const p = await parseBody(c, DatasetPatch)
    if ('error' in p) return c.json({ error: p.error }, 400)
    if (!(await store.datasets.get(id))) return c.json({ error: 'dataset not found' }, 404)
    await store.datasets.update(id, { ...p.data, now: Date.now() })
    return c.json(await getDataset(store, id))
  })
  app.delete('/api/datasets/:id', async (c) => {
    const id = c.req.param('id')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    await store.datasets.delete(id)
    return c.json({ deleted: true })
  })
  app.post('/api/datasets/:id/items', async (c) => {
    const id = c.req.param('id')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    if (!(await store.datasets.get(id))) return c.json({ error: 'dataset not found' }, 404)
    const p = await parseBody(c, ScenarioInput)
    if ('error' in p) return c.json({ error: p.error }, 400)
    const { slug: wanted, ...rest } = p.data
    const existing = new Set((await store.datasets.items(id)).map((i) => i.id))
    const base = wanted ?? slugify(rest.title)
    let slug = base
    for (let n = 2; existing.has(datasetItemId(id, slug)); n++) slug = `${base}-${n}`
    const scenario: Scenario = { ...rest, id: datasetItemId(id, slug) }
    await store.datasets.upsertItem(id, scenario, Date.now())
    return c.json(scenario, 201)
  })
  app.put('/api/datasets/:id/items/:itemId', async (c) => {
    const id = c.req.param('id')
    const itemId = c.req.param('itemId')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    const current = (await store.datasets.items(id)).find((i) => i.id === itemId)
    if (!current) return c.json({ error: 'item not found' }, 404)
    const p = await parseBody(c, ScenarioInput)
    if ('error' in p) return c.json({ error: p.error }, 400)
    const { slug: _slug, ...rest } = p.data
    const scenario: Scenario = { ...rest, id: itemId }
    await store.datasets.upsertItem(id, scenario, Date.now(), current.position)
    return c.json(scenario)
  })
  app.delete('/api/datasets/:id/items/:itemId', async (c) => {
    const id = c.req.param('id')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    await store.datasets.deleteItem(id, c.req.param('itemId'))
    return c.json({ deleted: true })
  })
  app.post('/api/datasets/:id/items/reorder', async (c) => {
    const id = c.req.param('id')
    if (isBuiltinDatasetId(id)) return c.json({ error: 'the built-in dataset is read-only' }, 409)
    const p = await parseBody(c, z.object({ ids: z.array(z.string()) }))
    if ('error' in p) return c.json({ error: p.error }, 400)
    await store.datasets.reorder(id, p.data.ids, Date.now())
    return c.json(await getDataset(store, id))
  })

  // ---------- suites ----------

  app.get('/api/suites', async (c) => {
    const rows = await store.suites.list(100)
    const out = []
    for (const r of rows) out.push(await suites.detail(r.id))
    return c.json(out.filter((d) => d !== null))
  })
  app.post('/api/suites', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be JSON' }, 400)
    }
    try {
      const { suiteId } = await suites.start(body as Parameters<SuiteRunner['start']>[0])
      return c.json({ suiteId }, 201)
    } catch (err) {
      const msg =
        err instanceof z.ZodError
          ? z.prettifyError(err)
          : err instanceof Error
            ? err.message
            : String(err)
      return c.json({ error: msg }, 400)
    }
  })
  app.get('/api/suites/:id', async (c) => {
    const d = await suites.detail(c.req.param('id'))
    return d ? c.json(d) : c.json({ error: 'suite not found' }, 404)
  })
  app.post('/api/suites/:id/cancel', (c) => c.json({ cancelled: suites.cancel(c.req.param('id')) }))
  app.delete('/api/suites/:id', async (c) => {
    const id = c.req.param('id')
    if (suites.isActive(id)) return c.json({ error: 'suite is active; cancel it first' }, 409)
    await store.suites.delete(id)
    return c.json({ deleted: true })
  })
  app.get('/api/suites/:id/metrics', async (c) => {
    const d = await suites.detail(c.req.param('id'))
    return d ? c.json(await suiteMetrics(store, d)) : c.json({ error: 'suite not found' }, 404)
  })
  app.get('/api/suites/:id/telemetry', async (c) => {
    const d = await suites.detail(c.req.param('id'))
    return d ? c.json(await suiteTelemetry(store, d)) : c.json({ error: 'suite not found' }, 404)
  })
  app.get('/api/suites/:id/spans', async (c) => {
    const q = c.req.query()
    const rows = await store.spans.forSuite(c.req.param('id'), {
      ...(q.kind ? { kinds: q.kind.split(',') } : {}),
    })
    return c.json(q.variant ? rows.filter((r) => r.attributes['cafe.variant'] === q.variant) : rows)
  })

  // ---------- runs ----------

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
  // OpenTelemetry spans for a run: raw for drill-down, aggregated for the charts. Both work mid-run.
  app.get('/api/runs/:id/spans', async (c) => {
    const q = c.req.query()
    const rows = await store.spans.forRun(c.req.param('id'), {
      ...(q.txId ? { txId: q.txId } : {}),
      ...(q.kind ? { kinds: q.kind.split(',') } : {}),
      limit: Math.min(20_000, Number(q.limit) || 5000),
      offset: Number(q.offset) || 0,
    })
    return c.json(rows)
  })
  app.get('/api/runs/:id/telemetry', async (c) => {
    const id = c.req.param('id')
    const [rows, metrics] = await Promise.all([
      store.spans.forRun(id, { limit: 20_000 }),
      store.metrics.get(id),
    ])
    return c.json(runTelemetry(id, rows, metrics))
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
   * Point an MCP client at it and it sees exactly that role's tool slice in the run's domain.
   */
  app.all('/mcp/:runId/:role', async (c) => {
    const role = c.req.param('role') as Role
    if (!(role in ROLE_SCOPES) || role === 'customer' || role === 'judge')
      return c.json({ error: 'role must be cashier, barista, or manager' }, 400)
    const runId = c.req.param('runId')
    const run = await store.runs.get(runId)
    if (!run) return c.json({ error: 'run not found' }, 404)
    const events: unknown[] = []
    // the run's own domain decides which tools and scopes the external client sees
    const pack = domainPack(run.config.domain)
    const gateway = new Gateway({
      store,
      emit: (e) => events.push(e),
      tools: pack.tools,
      roleScopes: pack.roleScopes,
    })
    const cap = gateway.capability({ agentId: `external-${role}`, role, runId })
    const server = createMcpServer(gateway, cap)
    const transport = new WebStandardStreamableHTTPServerTransport({})
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  return app
}
