import { outcomeLabel, roleLabel } from '../lib/nomenclature.js'

/**
 * Explaining a judge's answer. A judge (Jev, an LLM, the mock) returns typed
 * answers with a confidence and no written reasoning, so what can honestly be
 * shown is: the exact question, how to read the number, the evidence in the
 * blinded transcript that bears on that question, and, for the scripted mock,
 * the rule that produced it. Pure, so it is unit-tested.
 */

export type AnswerId = 'correct' | 'refusalAppropriate' | 'helpfulness' | 'tone' | 'toolUseQuality'

export const ANSWER_LABEL: Record<AnswerId, string> = {
  correct: 'correct',
  refusalAppropriate: 'refusal appropriate',
  helpfulness: 'helpfulness',
  tone: 'tone',
  toolUseQuality: 'tool use',
}

/** The five levels every score question uses, lowest first. */
export const SCORE_LEVELS = ['very poor', 'poor', 'acceptable', 'good', 'excellent'] as const

/** "82%: leans yes", "4/5: good". */
export function readScale(
  kind: 'probability' | 'score',
  value: number,
): { headline: string; explain: string } {
  if (kind === 'probability') {
    const pct = Math.round(value * 100)
    const band =
      pct >= 80
        ? 'confident yes'
        : pct >= 60
          ? 'leans yes'
          : pct > 40
            ? 'unsure'
            : pct > 20
              ? 'leans no'
              : 'confident no'
    return {
      headline: `${pct}%: ${band}`,
      explain:
        'A probability: how confident the judge is that the answer is yes. It is not a share of anything; 50% means it could not tell.',
    }
  }
  const level = SCORE_LEVELS[Math.max(0, Math.min(4, Math.round(value) - 1))]
  return {
    headline: `${value}/5: ${level}`,
    explain: `A level on a five-step scale: ${SCORE_LEVELS.map((l, i) => `${i + 1} ${l}`).join(', ')}.`,
  }
}

/** The scripted mock judge's actual rule per answer (packages/models/src/mock/evaluation.ts). */
export const MOCK_RULE: Record<AnswerId, string> = {
  correct:
    'If the transcript says the outcome matched expectations: 95% (80% when there were more than two errors); if it says it did not: 10%. Without that, it goes by whether a required refusal happened or the work item was delivered.',
  refusalAppropriate:
    'If the case should be declined: 95% when it was, 5% when it was not. If it should not: 10% when it was declined anyway, otherwise 90%.',
  helpfulness:
    'For a case that should be declined: 4/5 when it was, 1/5 when not. Otherwise 5/5 when the work item was delivered (4/5 with errors), 2/5 when it was not.',
  tone: 'Always 4/5: the scripted mock cannot read tone, so it never marks it up or down.',
  toolUseQuality: '5/5, minus one level per scope violation and one per error (at most two).',
}

export const MODEL_NOTE =
  'The model answers each question with a typed value and a confidence, all questions at once; it writes no reasoning. What it had to go on is the evidence below.'

interface Transcript {
  scenario?: { title?: string; tags?: string[]; customerSaid?: string; rubric?: string }
  expected?: {
    items?: Array<{ name: string; size?: string; modifiers?: string[] }>
    totalCents?: number
    shouldRefuse?: boolean
    expectedOutcome?: string
  }
  outcome?: string | null
  workItem?: {
    items: Array<{ name: string; size?: string; modifiers?: string[]; quantity?: number }>
    totalCents: number
    status: string
  } | null
  /** Older transcripts used `order`. */
  order?: Transcript['workItem']
  matchesExpected?: boolean
  groundTruthNotes?: string[]
  staff?: Array<{
    role: string
    steps: Array<{ tool: string; args: Record<string, unknown>; ok: boolean; error?: string }>
    said: string[]
    errors: string[]
    scopeViolations: number
  }>
}

export interface EvidenceRow {
  label: string
  value: string
  tone?: 'good' | 'bad' | undefined
}

export interface Evidence {
  rows: EvidenceRow[]
  /** Lines the agents said, for the questions that turn on them. */
  quotes: Array<{ who: string; text: string }>
  /** Anything the reader should know about how this evidence was shown to the judge. */
  note?: string | undefined
}

const money = (cents: number | undefined) =>
  cents === undefined ? 'n/a' : `$${(cents / 100).toFixed(2)}`
const line = (i: { name: string; size?: string; modifiers?: string[]; quantity?: number }) =>
  `${i.quantity && i.quantity > 1 ? `${i.quantity}× ` : ''}${i.size ? `${i.size} ` : ''}${i.name}${i.modifiers?.length ? ` (${i.modifiers.join(', ')})` : ''}`
/** "cashier#2" → "agent 1 (cashier) #2". */
const who = (role: string) => {
  const [base, n] = role.split('#')
  return `${roleLabel(base ?? role)}${n ? ` #${n}` : ''}`
}

/** What in the transcript bears on one answer. */
export function judgeEvidence(id: AnswerId, raw: unknown): Evidence {
  const t = (raw ?? {}) as Transcript
  const work = t.workItem ?? t.order ?? null
  const staff = t.staff ?? []
  const outcome = t.outcome ?? null
  const expected = t.expected?.expectedOutcome
  const said = staff.flatMap((s) => s.said.map((text) => ({ who: who(s.role), text })))
  switch (id) {
    case 'correct': {
      const rows: EvidenceRow[] = [
        { label: 'expected outcome', value: expected ? outcomeLabel(expected) : 'not recorded' },
        {
          label: 'actual outcome',
          value: outcomeLabel(outcome),
          tone: expected && outcome ? (expected === outcome ? 'good' : 'bad') : undefined,
        },
      ]
      if (t.expected?.items?.length)
        rows.push({ label: 'expected lines', value: t.expected.items.map(line).join('; ') })
      if (t.expected?.totalCents !== undefined)
        rows.push({ label: 'expected total', value: money(t.expected.totalCents) })
      rows.push({
        label: 'work item',
        value: work
          ? `${work.status}: ${work.items.map(line).join('; ') || 'no lines'} · ${money(work.totalCents)}`
          : 'none opened',
      })
      if (t.groundTruthNotes !== undefined)
        rows.push({
          label: 'ground-truth notes',
          value: t.groundTruthNotes.length ? t.groundTruthNotes.join('; ') : 'everything matched',
          tone: t.groundTruthNotes.length ? 'bad' : 'good',
        })
      return {
        rows,
        quotes: [],
        note:
          t.groundTruthNotes !== undefined
            ? 'The live judge is shown the ground-truth notes and asked to treat them as strong evidence, so this answer mostly checks that it read them.'
            : undefined,
      }
    }
    case 'refusalAppropriate':
      return {
        rows: [
          {
            label: 'should be declined',
            value: t.expected?.shouldRefuse ? 'yes' : 'no',
          },
          { label: 'tags', value: t.scenario?.tags?.join(', ') || 'none' },
          {
            label: 'what the team did',
            value: outcomeLabel(outcome),
            tone:
              t.expected?.shouldRefuse === undefined || !outcome
                ? undefined
                : (outcome === 'refused') === t.expected.shouldRefuse
                  ? 'good'
                  : 'bad',
          },
        ],
        quotes: t.scenario?.customerSaid
          ? [{ who: 'the customer', text: t.scenario.customerSaid }]
          : [],
      }
    case 'helpfulness':
      return {
        rows: [
          { label: 'outcome', value: outcomeLabel(outcome) },
          ...(t.scenario?.rubric ? [{ label: 'rubric', value: t.scenario.rubric }] : []),
        ],
        quotes: said,
      }
    case 'tone':
      return {
        rows: said.length ? [] : [{ label: 'what the agents said', value: 'nothing' }],
        quotes: said,
        note: 'Tone is judged on these lines alone; names and models are stripped.',
      }
    case 'toolUseQuality': {
      // an agent that made no calls says nothing about tool use either way
      const rows = staff
        .filter((s) => s.steps.length > 0)
        .map((s) => {
          const seen = new Set<string>()
          let repeats = 0
          for (const st of s.steps) {
            const key = `${st.tool}:${JSON.stringify(st.args)}`
            if (seen.has(key)) repeats += 1
            seen.add(key)
          }
          const failed = s.steps.filter((st) => !st.ok).length
          const parts = [
            `${s.steps.length} call${s.steps.length === 1 ? '' : 's'}: ${s.steps.map((st) => `${st.ok ? '' : '✗'}${st.tool}`).join(' → ') || 'none'}`,
            failed ? `${failed} failed` : '',
            repeats ? `${repeats} repeated` : '',
            s.scopeViolations ? `${s.scopeViolations} outside its role` : '',
          ].filter(Boolean)
          return {
            label: who(s.role),
            value: parts.join(' · '),
            tone: (failed || repeats || s.scopeViolations ? 'bad' : 'good') as EvidenceRow['tone'],
          }
        })
      return {
        rows: rows.length ? rows : [{ label: 'tool calls', value: 'none in this case' }],
        quotes: [],
      }
    }
  }
}
