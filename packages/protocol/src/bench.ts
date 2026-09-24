/**
 * The decision bench's shapes, shared by the server that runs it and the page that
 * shows it. The runner lives in @cafe/evals (bench.ts).
 */
export type BenchTask = 'door' | 'gate' | 'judge'
export const BENCH_TASKS: readonly BenchTask[] = ['door', 'gate', 'judge']

export const BENCH_TASK_INFO: Record<BenchTask, { label: string; question: string }> = {
  door: {
    label: 'Door guardrail',
    question: 'Turn this request away before an agent works on it?',
  },
  gate: { label: 'Action gate', question: 'Allow this proposed action?' },
  judge: { label: 'Judge (ground truth hidden)', question: 'Did the agents get this case right?' },
}

/** A bench item without the state the model read: what the report keeps. */
export interface BenchItemSummary {
  id: string
  task: BenchTask
  title: string
  instructions: string
  label: boolean
  note?: string | undefined
}

export interface BenchAnswer {
  /** P(yes); null when the call failed. */
  p: number | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
  error?: string | undefined
}

export interface BenchScore {
  spec: string
  task: BenchTask
  n: number
  answered: number
  errors: number
  /** Decision at P >= 0.5 against the label. */
  accuracy: number | null
  /** Of the items it said yes to, how many were yes. */
  precision: number | null
  /** Of the yes items, how many it caught. */
  recall: number | null
  /** Mean squared error of P against the label: 0 is perfect, 0.25 is a coin at 50%. Lower is better calibrated. */
  brier: number | null
  latency: { p50: number; p95: number; max: number } | null
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface BenchReport {
  specs: string[]
  tasks: BenchTask[]
  items: Array<BenchItemSummary & { answers: Record<string, BenchAnswer> }>
  scores: BenchScore[]
  /** Share of items two specs decided the same way, per task. */
  agreement: Array<{ task: BenchTask; a: string; b: string; rate: number | null }>
  startedAt: number
  finishedAt: number
}

export interface BenchProgress {
  done: number
  total: number
}
