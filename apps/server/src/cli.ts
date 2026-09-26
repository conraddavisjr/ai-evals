import { readFileSync } from 'node:fs'
import { loadEnv } from './env.js'

loadEnv()

import { resolve } from 'node:path'
import { createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { domainPack } from '@cafe/domains'
import { BENCH_TASK_INFO, type BenchTask } from '@cafe/evals'
import { isMockSpec, RunConfig, type RunConfigInput, vocabularyFor } from '@cafe/protocol'
import { BenchRunner } from './bench.js'
import { EventBus } from './event-bus.js'
import { orchestratorFor } from './orchestrators/index.js'
import { RunManager } from './run-manager.js'
import { getDataset, resolveScenarios } from './scenarios.js'
import { suiteMetrics } from './suite-results.js'
import { SuiteRunner } from './suite-runner.js'
import { initTracing } from './telemetry/tracing.js'

/**
 * Headless eval runner. Runs one or more shift configs back to back and prints a
 * comparison table; every run is persisted and can be replayed in the web UI.
 *
 *   pnpm eval --config runs/compare-models.json
 *   pnpm eval --cashier anthropic/claude-haiku-4-5-20251001 --judge gateway:typesafe-ai/jev
 *   pnpm eval --scenarios latte-simple,prompt-injection --instant
 *   pnpm eval --domain support --instant   (another business: its golden dataset and mock agents)
 *   pnpm eval --dataset <datasetId>        (a saved golden dataset; ids may be mixed in --scenarios)
 *   pnpm eval --suite runs/suite.example.json   (variants x repeats over one dataset, side by side)
 *   pnpm eval --domain support --gate gateway:typesafe-ai/jev   (a decision model approves payouts)
 *   pnpm eval --route                      (the router turns adversarial cases away before agent 1)
 *   pnpm eval --bench --domain support --specs mock:support-lead,gateway:typesafe-ai/jev,anthropic/claude-haiku-4-5-20251001
 *        [--tasks door,gate,judge] [--judge-run <runId>]   (decision bench: same labelled decisions, model vs model)
 *   flags: --router --no-judge --no-review --max-usd 0.5 --orchestrator evals-cafe
 */
function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

const INSTANT = {
  llmStepMs: [0, 0] as [number, number],
  toolMs: [0, 0] as [number, number],
  hangOrders: [],
  hangMs: 0,
}

function configsFromArgs(
  args: Record<string, string | boolean>,
  datasetIds: string[] | null,
): RunConfigInput[] {
  if (typeof args.config === 'string') {
    // pnpm runs this from apps/server; resolve relative to where the user typed the command.
    const file = resolve(process.env.INIT_CWD ?? process.cwd(), args.config)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RunConfigInput | RunConfigInput[]
    return Array.isArray(raw) ? raw : [raw]
  }
  const str = (k: string, d: string) => (typeof args[k] === 'string' ? (args[k] as string) : d)
  const pack = domainPack(str('domain', 'cafe'))
  const cfg: RunConfigInput = {
    name: str('name', 'cli'),
    domain: pack.id,
    orchestrator: str('orchestrator', 'evals-cafe'),
    scenarioIds:
      typeof args.scenarios === 'string'
        ? args.scenarios.split(',')
        : (datasetIds ?? pack.dataset.scenarios.map((s) => s.id)),
    roles: {
      cashier: str('cashier', pack.defaultRoles.cashier),
      barista: str('barista', pack.defaultRoles.barista),
      manager: str('manager', pack.defaultRoles.manager),
      judge: str('judge', pack.defaultRoles.judge),
    },
    staffing: { cashiers: Number(str('cashiers', '2')), baristas: Number(str('baristas', '1')) },
    triageRoutes: args.route === true,
    gate: args.gate
      ? { enabled: true, ...(typeof args.gate === 'string' ? { modelSpec: args.gate } : {}) }
      : { enabled: false },
    arrivalGapMs: Number(str('gap', '0')),
    judgeEnabled: args['no-judge'] !== true,
    // the router is opt-in; --route implies it
    triageEnabled: args.router === true || args.route === true,
    reviewEnabled: args['no-review'] !== true,
  }
  if (args.instant) cfg.mockPacing = INSTANT
  if (typeof args['max-usd'] === 'string') cfg.budget = { maxUsdPerRun: Number(args['max-usd']) }
  return [cfg]
}

const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? '  –  ' : `${(x * 100).toFixed(0).padStart(4)}%`
const ms = (x: number) => (x < 1000 ? `${Math.round(x)}ms` : `${(x / 1000).toFixed(1)}s`)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { db, close } = createDb()
  await runMigrations(db)
  await seedCatalog(db)
  const store = createPgStore(db)
  // CLI runs are persisted and replayable, so they get the same spans as server runs.
  const tracing =
    process.env.CAFE_TRACING === 'false'
      ? null
      : initTracing({ store, otlpUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })

  if (args.bench) {
    await runBenchCli(store, args)
    await tracing?.shutdown()
    await close()
    return
  }

  if (typeof args.suite === 'string') {
    await runSuite(store, resolve(process.env.INIT_CWD ?? process.cwd(), args.suite))
    await tracing?.shutdown()
    await close()
    return
  }

  let datasetIds: string[] | null = null
  if (typeof args.dataset === 'string') {
    const d = await getDataset(store, args.dataset)
    if (!d) {
      console.error(`Dataset ${args.dataset} not found.`)
      process.exit(2)
    }
    datasetIds = d.items.map((i) => i.id)
  }
  const configs = configsFromArgs(args, datasetIds).map((c) => RunConfig.parse(c))
  const allowLive = process.env.CAFE_ALLOW_LIVE_MODELS === 'true'
  for (const c of configs) {
    const live = Object.values(c.roles).filter((s) => !isMockSpec(s))
    if (live.length && !allowLive) {
      console.error(
        `Live models requested (${live.join(', ')}) but CAFE_ALLOW_LIVE_MODELS is not "true".`,
      )
      process.exit(2)
    }
  }

  const rows: string[][] = []
  for (const [i, config] of configs.entries()) {
    const scenarios = await resolveScenarios(store, config.scenarioIds)
    const run = await store.runs.create(config)
    const bus = new EventBus(run.id, store)
    const label = `${config.roles.cashier} / ${config.roles.barista} / ${config.roles.manager} / ${config.roles.judge}`
    const words = vocabularyFor(config.domain)
    console.log(
      `\n[${i + 1}/${configs.length}] run ${run.id} · ${words.business}\n  ${label}\n  ${config.scenarioIds.length} cases, ${config.staffing.cashiers} × agent 1 (${words.roles.cashier}), ${config.staffing.baristas} × agent 2 (${words.roles.barista})`,
    )
    let served = 0
    let caseNo = 0
    bus.subscribe((e) => {
      if (e.type === 'customer.left') {
        served += e.outcome === 'served' ? 1 : 0
        caseNo += 1
        const arrived = bus.buffer.find((a) => a.txId === e.txId && a.type === 'customer.arrived')
        const title =
          arrived?.type === 'customer.arrived' ? (arrived.title ?? arrived.scenarioId) : ''
        process.stdout.write(`  ${words.outcomes[e.outcome].padEnd(9)} case ${caseNo}: ${title}\n`)
      }
      if (e.type === 'agent.error')
        process.stdout.write(`  ! ${e.agentId} ${e.kind}: ${e.message}\n`)
    })
    const started = Date.now()
    await orchestratorFor(config.orchestrator).create({ store, bus, config, scenarios }).run()
    const m = await store.metrics.get(run.id)
    if (!m) continue
    rows.push([
      run.id.slice(-8),
      label,
      String(m.transactions),
      pct(m.taskSuccessRate),
      pct(m.refusalAccuracy),
      pct(m.meanToolPrecision),
      pct(m.meanToolRecall),
      String(m.scopeViolations),
      ms(m.endToEnd.p50),
      ms(m.endToEnd.p95),
      m.judgeMeans ? pct(m.judgeMeans.correct) : '  –  ',
      m.reviewCounts
        ? `${m.reviewCounts.ok}/${m.reviewCounts.concern}/${m.reviewCounts.escalate}`
        : '–',
      `$${m.costUsd.toFixed(4)}`,
      ms(Date.now() - started),
    ])
    console.log(
      `  done: ${served}/${m.transactions} ${words.outcomes.served}, task success ${pct(m.taskSuccessRate)}, cost $${m.costUsd.toFixed(4)}`,
    )
  }

  const header = [
    'run',
    'cashier / barista / manager / judge',
    'n',
    'pass',
    'refuse',
    'toolP',
    'toolR',
    'scope',
    'e2e p50',
    'e2e p95',
    'judge',
    'review ok/concern/esc',
    'cost',
    'wall',
  ]
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
  console.log(`\n${line(header)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`)
  for (const r of rows) console.log(line(r))
  console.log('\nReplay any run in the web UI from the Shift tab.')
  await tracing?.shutdown()
  await close()
}

/** A suite from a JSON file (SuiteConfig): every variant over the same items, then the comparison. */
async function runSuite(store: ReturnType<typeof createPgStore>, file: string) {
  const input = JSON.parse(readFileSync(file, 'utf8')) as Parameters<SuiteRunner['start']>[0]
  const runs = new RunManager(store, process.env.CAFE_ALLOW_LIVE_MODELS === 'true')
  const suites = new SuiteRunner(store, runs)
  const { suiteId } = await suites.start(input)
  console.log(
    `suite ${suiteId}: ${input.variants.length} variant(s), concurrency ${input.concurrency ?? 1}`,
  )
  const tick = setInterval(async () => {
    const d = await suites.detail(suiteId)
    if (d)
      process.stdout.write(
        `  ${d.progress.done}/${d.progress.total} done, ${d.progress.running} running\n`,
      )
  }, 2000)
  await suites.whenDone(suiteId)
  clearInterval(tick)
  const detail = await suites.detail(suiteId)
  if (!detail) return
  const view = await suiteMetrics(store, detail)
  const header = [
    'variant',
    'run',
    'status',
    'n',
    'pass',
    'refuse',
    'scope',
    'e2e p50',
    'judge',
    'review ok/concern/esc',
    'cost',
  ]
  const rows = view.variants.map((v) => {
    const m = v.result
    return [
      v.key,
      v.runId?.slice(-8) ?? '–',
      v.status,
      m ? String(m.transactions) : '–',
      pct(m?.taskSuccessRate),
      pct(m?.refusalAccuracy),
      m ? String(m.scopeViolations) : '–',
      m ? ms(m.endToEnd.p50) : '–',
      m?.judgeMeans ? pct(m.judgeMeans.correct) : '  –  ',
      m?.reviewCounts
        ? `${m.reviewCounts.ok}/${m.reviewCounts.concern}/${m.reviewCounts.escalate}`
        : '–',
      m ? `$${m.costUsd.toFixed(4)}` : '–',
    ]
  })
  printTable(header, rows)
  // item x variant: which golden items each variant passed
  const grid = view.matrix.map((r) => [
    r.title.slice(0, 32),
    ...view.variants.map((v) => {
      const c = r.cells[v.key]
      return c ? `${c.taskSuccess ? '✓' : '✗'} ${c.outcome ?? '?'}` : '–'
    }),
  ])
  console.log('')
  printTable(['item', ...view.variants.map((v) => v.key)], grid)
  console.log(`\nSuite ${detail.status}. Open any run in the web UI from the Shift tab.`)
}

function printTable(header: string[], rows: string[][]) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
  console.log(`\n${line(header)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`)
  for (const r of rows) console.log(line(r))
}

/** The decision bench from the terminal: waits for the report and prints one table per task. */
async function runBenchCli(
  store: ReturnType<typeof createPgStore>,
  args: Record<string, string | boolean>,
) {
  const list = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).split(',') : null)
  const domain = typeof args.domain === 'string' ? args.domain : 'cafe'
  const runner = new BenchRunner(store, process.env.CAFE_ALLOW_LIVE_MODELS === 'true')
  const { id, items } = await runner.start({
    domain,
    specs: list('specs') ?? [domainPack(domain).defaultRoles.manager],
    tasks: (list('tasks') ?? [
      'door',
      'gate',
      ...(args['judge-run'] ? ['judge'] : []),
    ]) as BenchTask[],
    ...(typeof args['judge-run'] === 'string' ? { judgeRunId: args['judge-run'] } : {}),
  })
  console.log(`bench ${id}: ${items} decisions per model`)
  for (;;) {
    const b = await runner.get(id)
    if (b?.status !== 'running') {
      if (!b?.report) throw new Error(b?.error ?? 'bench failed')
      const pct = (x: number | null) =>
        x === null ? '  -  ' : `${(x * 100).toFixed(0)}%`.padStart(5)
      for (const task of b.report.tasks) {
        console.log(`\n${BENCH_TASK_INFO[task].label}: ${BENCH_TASK_INFO[task].question}`)
        console.log(
          '  model                                        n  acc    prec   recall brier  p50     p95     cost',
        )
        for (const sc of b.report.scores.filter((x) => x.task === task))
          console.log(
            `  ${sc.spec.padEnd(42)} ${String(sc.answered).padStart(3)}  ${pct(sc.accuracy)}  ${pct(sc.precision)}  ${pct(sc.recall)}  ${sc.brier === null ? '  -  ' : sc.brier.toFixed(3)}  ${`${sc.latency?.p50 ?? '-'}ms`.padStart(6)}  ${`${sc.latency?.p95 ?? '-'}ms`.padStart(6)}  $${sc.costUsd.toFixed(5)}${sc.errors ? `  ${sc.errors} errors` : ''}`,
          )
      }
      console.log('\nOpen it on the Decision bench page to see every disagreement.')
      return
    }
    process.stdout.write(`\r  ${b.progress?.done ?? 0}/${b.progress?.total ?? '?'}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
