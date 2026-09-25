import { readFileSync } from 'node:fs'
import type { Target, TargetResult } from './http-target.js'
import { ConfigError } from './load.js'
import type { Report } from './runner.js'

/**
 * A target that answers from an earlier run's report instead of calling the app.
 * Re-scores saved answers with the current assertions and judge, so fixing a
 * dataset or trying another judge costs nothing on the app's side. Spend is
 * reported as zero because nothing was spent again.
 */
export function replayTarget(file: string): Target {
  let report: Report
  try {
    report = JSON.parse(readFileSync(file, 'utf8')) as Report
  } catch (err) {
    throw new ConfigError(`${file}: ${(err as Error).message}`)
  }
  const saved = new Map<string, TargetResult>()
  for (const c of report.cases ?? [])
    for (const a of c.attempts) if (a.result) saved.set(`${c.id}#${a.attempt}`, a.result)
  if (!saved.size) throw new ConfigError(`${file} holds no answers to replay`)
  return {
    kind: 'http',
    describe: () => `replay of ${report.target} (run ${report.runId})`,
    request: () => null,
    async invoke(c, ctx) {
      const r = saved.get(`${c.id}#${ctx.attempt}`) ?? saved.get(`${c.id}#1`)
      if (!r)
        return {
          outcome: 'failed',
          reason: 'not_in_replay',
          detail: `${c.id} is not in the replayed report`,
          output: null,
          steps: [],
          usage: null,
          model: null,
          latencyMs: 0,
          httpStatus: null,
          raw: null,
          contractErrors: [],
        }
      return { ...r, usage: r.usage ? { ...r.usage, usd: 0 } : null }
    },
  }
}
