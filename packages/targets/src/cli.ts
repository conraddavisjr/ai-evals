import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelRegistry } from '@cafe/models'
import { httpTarget } from './http-target.js'
import { checkJudge } from './judge.js'
import { ConfigError, loadPack, selectCases } from './load.js'
import { replayTarget } from './replay.js'
import { attemptLine, formatSummary, toJUnit, toMarkdown } from './report.js'
import { runPack } from './runner.js'
import { MissingEnvError } from './template.js'

const USAGE = `Evaluate another project's AI through its config pack.

  pnpm eval:target --config ../recipe-builder/evals/stardust.config.json
      [--cases id,id] [--tags adversarial,harmful] [--smoke]
      [--repeats 3] [--concurrency 2] [--max-usd 5]
      [--judge <model spec> | --no-judge]
      [--min-pass 0.9] [--min-pass-tag adversarial=1,benign=0.9]
      [--json out/report.json] [--junit out/junit.xml] [--summary out/summary.md]
      [--list] [--dry-run] [--replay out/report.json]

--replay re-scores the answers saved in an earlier --json report (current assertions and judge, no calls to the app).

Exit codes: 0 every gate passed · 1 a gate failed or the run was cut short · 2 bad config or flags.
$GITHUB_STEP_SUMMARY, when set, receives a Markdown summary.`

type Args = Record<string, string | true>

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (!a.startsWith('--')) throw new ConfigError(`Unexpected argument ${a}`)
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

/** The repo's .env, then the caller's; values the shell already set win. */
function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const before = { ...process.env }
  for (const f of [
    resolve(here, '../../../.env'),
    resolve(process.env.INIT_CWD ?? process.cwd(), '.env'),
  ]) {
    if (!existsSync(f)) continue
    try {
      process.loadEnvFile(f)
    } catch {}
  }
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v
}

const list = (v: string | true | undefined) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

const number = (args: Args, key: string): number | undefined => {
  const v = args[key]
  if (v === undefined) return undefined
  const n = Number(v)
  if (typeof v !== 'string' || !Number.isFinite(n)) throw new ConfigError(`--${key} needs a number`)
  return n
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.config) {
    console.log(USAGE)
    return args.help ? 0 : 2
  }
  loadEnv()
  // pnpm runs this from the package; resolve paths from where the command was typed.
  const cwd = process.env.INIT_CWD ?? process.cwd()
  const at = (p: string) => resolve(cwd, p)
  const pack = loadPack(at(String(args.config)))
  const cases = selectCases(pack.cases, {
    ids: list(args.cases),
    tags: list(args.tags),
    smoke: args.smoke === true,
  })
  if (!cases.length) throw new ConfigError('No cases selected')

  const target =
    typeof args.replay === 'string'
      ? replayTarget(at(args.replay))
      : httpTarget(pack.config.target, { responseSchema: pack.responseSchema })
  const runId = `t-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`

  if (args.list || args['dry-run']) {
    for (const c of cases) {
      console.log(`${c.id.padEnd(36)} [${c.tags.join(', ')}]${c.smoke ? ' smoke' : ''}  ${c.title}`)
      if (args['dry-run'])
        console.log(`  ${JSON.stringify(target.request(c, { runId, attempt: 1 }))}`)
    }
    console.log(`\n${cases.length} case(s) · ${target.describe()}`)
    return 0
  }

  const judgeSpec = args['no-judge']
    ? null
    : typeof args.judge === 'string'
      ? args.judge
      : (pack.config.judge?.model ?? null)
  if (judgeSpec && !pack.config.judge)
    throw new ConfigError('--judge needs judge questions in the config pack')
  const byTag = { ...pack.config.thresholds.byTag }
  for (const pair of list(args['min-pass-tag']) ?? []) {
    const [tag, v] = pair.split('=')
    const n = Number(v)
    if (!tag || !Number.isFinite(n))
      throw new ConfigError(`--min-pass-tag wants tag=0.9, got ${pair}`)
    byTag[tag] = n
  }
  const repeats = number(args, 'repeats') ?? pack.config.repeats
  const concurrency = number(args, 'concurrency') ?? pack.config.target.concurrency

  console.log(
    `${pack.config.name}: ${cases.length} case(s) × ${repeats} against ${target.describe()} · judge ${judgeSpec ?? 'off'} · run ${runId}\n`,
  )
  const registry = new ModelRegistry({ allowLive: true })
  if (judgeSpec) {
    const problem = await checkJudge(registry, judgeSpec)
    if (problem)
      throw new ConfigError(
        `The judge ${judgeSpec} is not answering, so no case was sent: ${problem}\nFix its key, pick another with --judge, or run with --no-judge.`,
      )
  }
  const controller = new AbortController()
  process.once('SIGINT', () => {
    console.log('\nStopping: finishing in-flight cases, skipping the rest.')
    controller.abort()
  })
  const report = await runPack({
    config: pack.config,
    cases,
    target,
    // The target is live by definition; the judge is whatever the pack or the flag names.
    registry,
    judgeSpec,
    repeats,
    concurrency,
    maxUsd: number(args, 'max-usd') ?? pack.config.budget.maxUsdPerRun ?? null,
    thresholds: { overall: number(args, 'min-pass') ?? pack.config.thresholds.overall, byTag },
    runId,
    signal: controller.signal,
    onAttempt: (a, c) => console.log(attemptLine(a, c.title)),
  })

  const unreachable = report.cases
    .flatMap((c) => c.attempts)
    .filter(
      (a) =>
        a.result?.reason === 'unreachable' ||
        a.result?.reason === 'http_404' ||
        a.result?.reason === 'http_401',
    )
  if (unreachable.length === report.totals.attempts)
    console.log(
      `\nEvery request failed to reach the target (${unreachable[0]?.result?.detail ?? ''}). Is the app running with EVAL_ENABLED=true and the same EVAL_SECRET?`,
    )
  console.log(formatSummary(report))
  if (typeof args.json === 'string') write(at(args.json), `${JSON.stringify(report, null, 2)}\n`)
  if (typeof args.junit === 'string') write(at(args.junit), toJUnit(report))
  if (typeof args.summary === 'string') write(at(args.summary), toMarkdown(report))
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, toMarkdown(report))
  return report.ok ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    if (err instanceof ConfigError || err instanceof MissingEnvError) {
      console.error(err.message)
      process.exitCode = 2
    } else {
      console.error(err)
      process.exitCode = 2
    }
  },
)
