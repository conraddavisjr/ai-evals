import { describeAssertion } from './assertions.js'
import type { PackConfig } from './config.js'
import { humanize } from './judge.js'
import type { LoadedCase } from './load.js'

/**
 * A project's golden cases as the dashboard lists them: what each sends, what it
 * expects, every check it runs and what the judge must say, grouped by dataset.
 * Read-only: the cases live in the project's repo and change there.
 */
export interface CaseView {
  id: string
  title: string
  dataset: string
  tags: string[]
  /** In the fast subset a pull request runs. */
  smoke: boolean
  /** The request text, when the input has one. */
  prompt: string
  /** Everything else the case sends (profile, count, filters ...). */
  input: Record<string, unknown>
  expect: { outcomes: string[]; reasons: string[] | null; checks: string[] }
  /** "only recipes: yes", "cookable ≥ 4". */
  judge: string[]
  skipJudge: boolean
  rubric: string | null
}

export interface CasesView {
  name: string
  target: string | null
  judge: {
    model: string
    questions: Array<{ id: string; type: string; instructions: string }>
  } | null
  thresholds: { overall: number | null; byTag: Record<string, number> }
  datasets: Array<{ name: string; count: number; smoke: number }>
  cases: CaseView[]
  total: number
  smoke: number
}

export function casesView(config: PackConfig, cases: LoadedCase[]): CasesView {
  const defaults = config.judge?.defaults ?? {}
  const view: CaseView[] = cases.map((c) => {
    const { prompt, ...rest } = c.input
    const judge = c.skipJudge ? {} : { ...defaults, ...c.judge }
    return {
      id: c.id,
      title: c.title,
      dataset: c.dataset,
      tags: c.tags,
      smoke: c.smoke,
      prompt:
        typeof prompt === 'string' ? prompt : prompt === undefined ? '' : JSON.stringify(prompt),
      input: rest,
      expect: {
        outcomes: c.expect.outcome === undefined ? [] : [c.expect.outcome].flat(),
        reasons: c.expect.reason ?? null,
        checks: c.expect.assertions.map(describeAssertion),
      },
      judge: Object.entries(judge).map(([id, want]) =>
        typeof want === 'boolean'
          ? `${humanize(id)}: ${want ? 'yes' : 'no'}`
          : `${humanize(id)} ${[want.min !== undefined ? `≥ ${want.min}` : '', want.max !== undefined ? `≤ ${want.max}` : ''].filter(Boolean).join(' and ')}`,
      ),
      skipJudge: c.skipJudge,
      rubric: c.rubric ?? null,
    }
  })
  const datasets = new Map<string, { name: string; count: number; smoke: number }>()
  for (const c of view) {
    const d = datasets.get(c.dataset) ?? { name: c.dataset, count: 0, smoke: 0 }
    d.count += 1
    if (c.smoke) d.smoke += 1
    datasets.set(c.dataset, d)
  }
  return {
    name: config.name,
    target: config.target.url,
    judge: config.judge
      ? {
          model: config.judge.model,
          questions: config.judge.questions.map((q) => ({
            id: q.id,
            type: q.type,
            instructions: q.instructions,
          })),
        }
      : null,
    thresholds: { overall: config.thresholds.overall ?? null, byTag: config.thresholds.byTag },
    datasets: [...datasets.values()],
    cases: view,
    total: view.length,
    smoke: view.filter((c) => c.smoke).length,
  }
}
