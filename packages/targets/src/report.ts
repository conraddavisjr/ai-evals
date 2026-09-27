import type { Attempt, CaseSummary, Report } from './runner.js'

const pct = (n: number) => `${(n * 100).toFixed(n === 1 || n === 0 ? 0 : 1)}%`
const pad = (s: string, n: number) => (s.length >= n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

/** The first failing attempt's failed checks, as short lines. */
export function failureLines(c: CaseSummary): string[] {
  const bad = c.attempts.find((a) => !a.passed)
  if (!bad) return []
  if (bad.skipped) return [`skipped: ${bad.skipped}`]
  return bad.checks.filter((k) => !k.ok).map((k) => `${k.label}: ${k.detail}`)
}

export function attemptLine(a: Attempt, title: string): string {
  const mark = a.skipped ? '–' : a.passed ? '✓' : '✗'
  const r = a.result
  const what = a.skipped
    ? a.skipped
    : `${r?.outcome ?? '?'}${r?.reason ? ` (${r.reason})` : ''} · ${((r?.latencyMs ?? 0) / 1000).toFixed(1)}s${r?.usage?.usd ? ` · $${r.usage.usd.toFixed(3)}` : ''}`
  return `${mark} ${pad(`${a.caseId}${a.attempt > 1 ? ` #${a.attempt}` : ''}`, 34)} ${pad(title, 44)} ${what}`
}

/** The plain-text summary printed at the end of a run. */
export function formatSummary(r: Report): string {
  const lines: string[] = []
  const failed = r.cases.filter((c) => !c.passAll)
  if (failed.length) {
    lines.push('', 'Failures')
    for (const c of failed) {
      lines.push(`  ${c.flaky ? '~' : '✗'} ${c.id} (${c.passes}/${c.attempts.length}) ${c.title}`)
      for (const l of failureLines(c)) lines.push(`      ${l}`)
    }
  }
  const byDataset = new Map<string, CaseSummary[]>()
  for (const c of r.cases) byDataset.set(c.dataset, [...(byDataset.get(c.dataset) ?? []), c])
  lines.push('', 'By dataset')
  for (const [name, list] of byDataset) {
    const at = list.flatMap((c) => c.attempts)
    const ok = at.filter((a) => a.passed).length
    lines.push(
      `  ${pad(name, 32)} ${String(ok).padStart(3)}/${String(at.length).padEnd(3)} ${pct(at.length ? ok / at.length : 0)}`,
    )
  }
  const flaky = r.cases.filter((c) => c.flaky)
  if (flaky.length)
    lines.push(
      '',
      `Flaky: ${flaky.map((c) => `${c.id} (${c.passes}/${c.attempts.length})`).join(', ')}`,
    )
  const t = r.totals
  lines.push(
    '',
    `Pass rate ${pct(t.passRate)} (${t.passed}/${t.attempts})${t.skipped ? `, ${t.skipped} skipped` : ''} · false refusals ${t.falseRefusals} · missed refusals ${t.missedRefusals} · target spend $${t.usd.toFixed(3)}${r.judge ? ` · judge ${r.judge} ${t.judgeInputTokens + t.judgeOutputTokens} tokens` : ' · no judge'}`,
    '',
    'Gates',
  )
  for (const g of r.gates)
    lines.push(
      `  ${g.ok ? '✓' : '✗'} ${pad(g.name, 28)} ${pct(g.actual)} (needs ${pct(g.required)}, ${g.attempts} attempts)`,
    )
  if (t.skipped) lines.push(`  ✗ complete run                 ${t.skipped} attempt(s) skipped`)
  lines.push('', r.ok ? 'PASS' : 'FAIL')
  return lines.join('\n')
}

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 forbids these characters
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** JUnit XML: one suite per dataset, one test case per golden case. CI renders these natively. */
export function toJUnit(r: Report): string {
  const byDataset = new Map<string, CaseSummary[]>()
  for (const c of r.cases) byDataset.set(c.dataset, [...(byDataset.get(c.dataset) ?? []), c])
  const out = ['<?xml version="1.0" encoding="UTF-8"?>']
  const total = r.cases.length
  const failures = r.cases.filter((c) => !c.passAll).length
  out.push(`<testsuites name="${xml(r.pack)}" tests="${total}" failures="${failures}">`)
  for (const [name, list] of byDataset) {
    const f = list.filter((c) => !c.passAll).length
    const secs =
      list.flatMap((c) => c.attempts).reduce((s, a) => s + (a.result?.latencyMs ?? 0), 0) / 1000
    out.push(
      `  <testsuite name="${xml(name)}" tests="${list.length}" failures="${f}" time="${secs.toFixed(3)}">`,
    )
    for (const c of list) {
      const time = c.attempts.reduce((s, a) => s + (a.result?.latencyMs ?? 0), 0) / 1000
      out.push(
        `    <testcase classname="${xml(name)}" name="${xml(`${c.id}: ${c.title}`)}" time="${time.toFixed(3)}">`,
      )
      if (!c.passAll) {
        const msg = failureLines(c).join('\n')
        out.push(
          `      <failure message="${xml(`${c.passes}/${c.attempts.length} attempts passed`)}">${xml(msg)}</failure>`,
        )
      }
      const log = c.attempts.map((a) => attemptLine(a, c.title)).join('\n')
      out.push(`      <system-out>${xml(log)}</system-out>`, '    </testcase>')
    }
    out.push('  </testsuite>')
  }
  out.push('</testsuites>')
  return `${out.join('\n')}\n`
}

/** Markdown for a CI job summary ($GITHUB_STEP_SUMMARY). */
export function toMarkdown(r: Report): string {
  const lines = [
    `### ${r.ok ? '✅' : '❌'} ${r.pack} evals: ${pct(r.totals.passRate)} (${r.totals.passed}/${r.totals.attempts})`,
    '',
    `Target \`${r.target}\` · judge ${r.judge ? `\`${r.judge}\`` : 'off'} · spend $${r.totals.usd.toFixed(3)} · false refusals ${r.totals.falseRefusals} · missed refusals ${r.totals.missedRefusals}`,
    '',
    '| Gate | Pass rate | Needs | |',
    '| --- | --- | --- | --- |',
    ...r.gates.map(
      (g) => `| ${g.name} | ${pct(g.actual)} | ${pct(g.required)} | ${g.ok ? '✓' : '✗'} |`,
    ),
  ]
  const failed = r.cases.filter((c) => !c.passAll)
  if (failed.length) {
    lines.push('', '| Case | Passed | Why |', '| --- | --- | --- |')
    for (const c of failed)
      lines.push(
        `| \`${c.id}\` ${c.title} | ${c.passes}/${c.attempts.length}${c.flaky ? ' (flaky)' : ''} | ${failureLines(c).join('<br>').replace(/\|/g, '\\|')} |`,
      )
  }
  return `${lines.join('\n')}\n`
}
