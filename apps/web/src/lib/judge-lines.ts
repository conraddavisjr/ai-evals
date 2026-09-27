import { answersLine, type CaseCheck, type JudgeAnswers, probabilityOf } from '@cafe/protocol'

/**
 * What the judge "says" about a case, for the scenes and the Cases list. The
 * standard question set leads with how sure it is the case was right; a config
 * pack's own questions are listed as asked (the case's pass or fail comes from
 * case.scored instead).
 */
export function judgeLine(answers: JudgeAnswers): { text: string; short: string; ok: boolean } {
  const correct = probabilityOf(answers, 'correct')
  if (correct !== null) {
    const ok = correct >= 0.5
    const rest = answersLine(answers, ' · ').split(' · ').slice(1, 3).join(' · ')
    return {
      text: `${ok ? '✓' : '✗'} correct ${Math.round(correct * 100)}%${rest ? ` · ${rest}` : ''}`,
      short: `judge ${Math.round(correct * 100)}% correct`,
      ok,
    }
  }
  const parts = answersLine(answers, ' · ').split(' · ')
  return {
    text: parts.slice(0, 3).join(' · '),
    short: `judge: ${parts.length} answer${parts.length === 1 ? '' : 's'}`,
    ok: true,
  }
}

/** "✓ all 9 checks pass", "✗ 2 of 9 checks failed: no bacon in the ingredients". */
export function scoredLine(passed: boolean, checks: CaseCheck[]): string {
  const failed = checks.filter((c) => !c.ok)
  if (passed) return `✓ all ${checks.length} check${checks.length === 1 ? '' : 's'} pass`
  return `✗ ${failed.length} of ${checks.length} failed: ${failed[0]?.label ?? ''}`
}
