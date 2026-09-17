import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { SCENARIOS } from '@cafe/evals'
import { isMockSpec, RunConfig, type RunConfigInput } from '@cafe/protocol'
import { EventBus } from './event-bus.js'
import { ShiftOrchestrator } from './orchestrator.js'

/**
 * Headless eval runner. Runs one or more shift configs back to back and prints a
 * comparison table; every run is persisted and can be replayed in the cafe UI.
 *
 *   pnpm eval --config runs/compare-models.json
 *   pnpm eval --cashier anthropic/claude-haiku-4-5-20251001 --judge gateway:typesafe-ai/jev
 *   pnpm eval --scenarios latte-simple,prompt-injection --instant
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

function configsFromArgs(args: Record<string, string | boolean>): RunConfigInput[] {
  if (typeof args.config === 'string') {
    // pnpm runs this from apps/server; resolve relative to where the user typed the command.
    const file = resolve(process.env.INIT_CWD ?? process.cwd(), args.config)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RunConfigInput | RunConfigInput[]
    return Array.isArray(raw) ? raw : [raw]
  }
  const str = (k: string, d: string) => (typeof args[k] === 'string' ? (args[k] as string) : d)
  const cfg: RunConfigInput = {
    name: str('name', 'cli'),
    scenarioIds:
      typeof args.scenarios === 'string' ? args.scenarios.split(',') : SCENARIOS.map((s) => s.id),
    roles: {
      cashier: str('cashier', 'mock:cashier'),
      barista: str('barista', 'mock:barista'),
      manager: str('manager', 'mock:manager'),
      judge: str('judge', 'mock:judge'),
    },
    staffing: { cashiers: Number(str('cashiers', '2')), baristas: Number(str('baristas', '1')) },
    arrivalGapMs: Number(str('gap', '0')),
    judgeEnabled: args['no-judge'] !== true,
    triageEnabled: args['no-triage'] !== true,
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
  const configs = configsFromArgs(args).map((c) => RunConfig.parse(c))
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
  const { db, close } = createDb()
  await runMigrations(db)
  await seedCatalog(db)
  const store = createPgStore(db)

  const rows: string[][] = []
  for (const [i, config] of configs.entries()) {
    const run = await store.runs.create(config)
    const bus = new EventBus(run.id, store)
    const label = `${config.roles.cashier} / ${config.roles.barista} / ${config.roles.manager} / ${config.roles.judge}`
    console.log(
      `\n[${i + 1}/${configs.length}] run ${run.id}\n  ${label}\n  ${config.scenarioIds.length} customers, ${config.staffing.cashiers} cashiers, ${config.staffing.baristas} baristas`,
    )
    let served = 0
    bus.subscribe((e) => {
      if (e.type === 'customer.left') {
        served += e.outcome === 'served' ? 1 : 0
        process.stdout.write(
          `  ${e.outcome.padEnd(9)} ${bus.buffer.find((a) => a.txId === e.txId && a.type === 'customer.arrived')?.type === 'customer.arrived' ? (bus.buffer.find((a) => a.txId === e.txId && a.type === 'customer.arrived') as { name: string }).name : ''}\n`,
        )
      }
      if (e.type === 'agent.error')
        process.stdout.write(`  ! ${e.agentId} ${e.kind}: ${e.message}\n`)
    })
    const started = Date.now()
    await new ShiftOrchestrator({ store, bus, config }).run()
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
      `$${m.costUsd.toFixed(4)}`,
      ms(Date.now() - started),
    ])
    console.log(
      `  done: ${served}/${m.transactions} served, task success ${pct(m.taskSuccessRate)}, cost $${m.costUsd.toFixed(4)}`,
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
    'cost',
    'wall',
  ]
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
  console.log(`\n${line(header)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`)
  for (const r of rows) console.log(line(r))
  console.log('\nReplay any run in the cafe UI from the Shift tab.')
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
