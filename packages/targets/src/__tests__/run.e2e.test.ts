import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelRegistry } from '@cafe/models'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EvalCase, HttpTargetConfig } from '../config.js'
import { httpTarget } from '../http-target.js'
import { loadPack } from '../load.js'
import { toJUnit } from '../report.js'
import { runPack } from '../runner.js'
import { type FakeApp, startFakeApp } from './fixtures/fake-app.js'

const here = dirname(fileURLToPath(import.meta.url))
const configFile = join(here, 'fixtures/stardust.config.json')
let app: FakeApp

beforeAll(async () => {
  app = await startFakeApp()
})
afterAll(async () => {
  await app.close()
})

const registry = new ModelRegistry({ allowLive: false })

describe('a config pack run against an HTTP target', () => {
  it('scores every case, asks the judge only after the checks pass, and gates by tag', async () => {
    const pack = loadPack(configFile, { FAKE_URL: app.url })
    const report = await runPack({
      config: pack.config,
      cases: pack.cases,
      target: httpTarget(pack.config.target, { responseSchema: pack.responseSchema }),
      registry,
      judgeSpec: 'mock:judge',
      repeats: 1,
      concurrency: 3,
      maxUsd: null,
      thresholds: pack.config.thresholds,
      runId: 't-test',
    })
    const byId = Object.fromEntries(report.cases.map((c) => [c.id, c]))
    expect(Object.keys(byId).sort()).toEqual(['inject', 'leak', 'python', 'soup', 'vegan-soup'])
    expect(byId.leak?.passAll).toBe(false)
    expect(byId.leak?.attempts[0]?.checks.find((k) => !k.ok)?.detail).toMatch(/You are Palate/)
    expect(byId.inject?.attempts[0]?.judge?.answers.refusalAppropriate).toEqual({
      probability: 0.95,
    })
    expect(byId.inject?.attempts[0]?.result?.reason).toBe('injection')
    expect(byId.soup?.attempts[0]?.result?.steps.map((s) => s.name)).toEqual([
      'classify',
      'drafting',
    ])
    // the body template filled the case, typed
    expect(app.calls.find((b) => b.case_id === 'soup')).toMatchObject({
      prompt: 'a cozy soup',
      count: 1,
      contract: 1,
    })
    expect(app.calls.find((b) => b.case_id === 'vegan-soup')).not.toHaveProperty('count')
    expect(report.totals).toMatchObject({
      attempts: 5,
      passed: 4,
      usd: 0.05,
      missedRefusals: 0,
      falseRefusals: 0,
    })
    expect(report.gates.map((g) => [g.name, g.ok])).toEqual([
      ['overall', true],
      ['tag adversarial', true],
    ])
    expect(report.ok).toBe(true)
    const junit = toJUnit(report)
    expect(junit).toContain('<testsuite name="benign" tests="3" failures="1"')
    expect(junit).toContain('<failure message="0/1 attempts passed">')
  })

  it('turns transport problems into failed attempts with a reason, and names flaky cases', async () => {
    const target = httpTarget(
      HttpTargetConfig.parse({
        kind: 'http',
        url: app.url,
        headers: { authorization: 'Bearer test-secret' },
        bodyTemplate: { prompt: '{{input.prompt}}' },
        responseMap: {
          outcome: '$.outcome',
          outcomeMap: { recipes: 'served', declined: 'refused' },
        },
        timeoutMs: 300,
      }),
    )
    const mk = (id: string, prompt: string) => ({
      ...EvalCase.parse({ id, title: id, input: { prompt }, expect: { outcome: 'served' } }),
      dataset: 'd',
    })
    const cases = [
      mk('crash', 'crash'),
      mk('slow', 'slow'),
      mk('flaky', 'flaky soup'),
      mk('error', 'flaky soup again'),
    ]
    const report = await runPack({
      config: loadPack(configFile, { FAKE_URL: app.url }).config,
      cases,
      target,
      registry,
      judgeSpec: null,
      repeats: 2,
      concurrency: 1,
      maxUsd: null,
      thresholds: { byTag: {} },
      runId: 't-test',
    })
    const reason = (id: string) =>
      report.cases.find((c) => c.id === id)?.attempts[0]?.result?.reason
    expect(reason('crash')).toBe('http_500')
    expect(reason('slow')).toBe('timeout')
    // "error" is not in this outcomeMap, so the second flaky call is unmapped
    const flaky = report.cases.find((c) => c.id === 'flaky')
    expect(flaky).toMatchObject({ passes: 1, flaky: true, passAny: true, passAll: false })
    expect(flaky?.attempts[1]?.result?.reason).toBe('unmapped_outcome')
    // no thresholds given: every case must pass
    expect(report.gates).toEqual([
      expect.objectContaining({ name: 'overall', required: 1, ok: false }),
    ])
    const unreachable = httpTarget(
      HttpTargetConfig.parse({
        kind: 'http',
        url: 'http://127.0.0.1:9/x',
        bodyTemplate: {},
        responseMap: { outcome: '$.o', outcomeMap: {} },
      }),
    )
    const r = await unreachable.invoke(mk('u', 'x'), { runId: 'r', attempt: 1 })
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unreachable' })
  })

  it('stops spending at the budget and never calls a cut-short run green', async () => {
    const pack = loadPack(configFile, { FAKE_URL: app.url })
    const report = await runPack({
      config: pack.config,
      cases: pack.cases.filter((c) => c.id === 'soup'),
      target: httpTarget(pack.config.target),
      registry,
      judgeSpec: null,
      repeats: 4,
      concurrency: 1,
      maxUsd: 0.02,
      thresholds: { overall: 0, byTag: {} },
      runId: 't-test',
    })
    expect(report.totals).toMatchObject({ attempts: 4, passed: 2, skipped: 2 })
    expect(report.ok).toBe(false)
  })
})

describe('the CLI', () => {
  const cli = resolve(here, '../cli.ts')
  // Async on purpose: the fake app answers from this same process.
  const run = (args: string[], env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
      const child = spawn(process.execPath, ['--import', 'tsx', cli, ...args], {
        cwd: resolve(here, '../..'),
        env: { ...process.env, INIT_CWD: here, FAKE_URL: app.url, GITHUB_STEP_SUMMARY: '', ...env },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => {
        stdout += d
      })
      child.stderr.on('data', (d) => {
        stderr += d
      })
      child.on('close', (status) => done({ status, stdout, stderr }))
    })

  it('exits 0 when the gates pass and writes JSON and JUnit', async () => {
    const out = mkdtempSync(join(tmpdir(), 'targets-'))
    const r = await run([
      '--config',
      'fixtures/stardust.config.json',
      '--json',
      join(out, 'r.json'),
      '--junit',
      join(out, 'j.xml'),
    ])
    expect(r.stdout).toContain('PASS')
    expect(r.status).toBe(0)
    expect(JSON.parse(readFileSync(join(out, 'r.json'), 'utf8')).totals.attempts).toBe(5)
    expect(readFileSync(join(out, 'j.xml'), 'utf8')).toContain('<testsuites name="Fake app"')
  })

  it('exits 1 when a threshold fails, and runs only the smoke subset when asked', async () => {
    const r = await run([
      '--config',
      'fixtures/stardust.config.json',
      '--min-pass',
      '1',
      '--no-judge',
    ])
    expect(r.stdout).toContain('FAIL')
    expect(r.status).toBe(1)
    const smoke = await run([
      '--config',
      'fixtures/stardust.config.json',
      '--smoke',
      '--min-pass',
      '1',
    ])
    expect(smoke.stdout).toContain('2 case(s)')
    expect(smoke.status).toBe(0)
  })

  it('re-scores a saved report without calling the app', async () => {
    const out = mkdtempSync(join(tmpdir(), 'targets-'))
    await run([
      '--config',
      'fixtures/stardust.config.json',
      '--no-judge',
      '--json',
      join(out, 'r.json'),
    ])
    const before = app.calls.length
    const r = await run(
      ['--config', 'fixtures/stardust.config.json', '--no-judge', '--replay', join(out, 'r.json')],
      { FAKE_URL: 'http://127.0.0.1:9/never' },
    )
    expect(app.calls.length).toBe(before)
    expect(r.stdout).toContain('replay of POST')
    expect(r.stdout).toContain('Pass rate 80.0% (4/5)')
    expect(r.stdout).toContain('target spend $0.000')
  })

  it('exits 2 on a bad config or a missing secret', async () => {
    const r = await run(['--config', 'fixtures/stardust.config.json'], { FAKE_URL: '' })
    expect(r.stderr).toContain('Missing environment variable: FAKE_URL')
    expect(r.status).toBe(2)
    expect(
      (await run(['--config', 'fixtures/stardust.config.json', '--cases', 'nope'])).status,
    ).toBe(2)
  })
})
