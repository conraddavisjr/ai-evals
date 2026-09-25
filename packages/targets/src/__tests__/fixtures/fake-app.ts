import { createServer, type Server } from 'node:http'

/**
 * A stand-in for an app's eval route (shaped like Palate's contract 1), so the
 * HTTP target, assertions, reports and exit codes are tested end to end with
 * no model and no network. Behaviour is keyed off the prompt.
 */
export interface FakeApp {
  url: string
  calls: Array<Record<string, unknown>>
  close(): Promise<void>
}

export async function startFakeApp(secret = 'test-secret'): Promise<FakeApp> {
  const calls: Array<Record<string, unknown>> = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => {
      body += d
    })
    req.on('end', () => {
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(json))
      }
      if (req.headers.authorization !== `Bearer ${secret}`)
        return send(401, { error: 'unauthorized' })
      const b = JSON.parse(body) as Record<string, unknown>
      calls.push(b)
      const prompt = String(b.prompt ?? '')
      const base = {
        contract: 1,
        guard_issues: [],
        review: { issues: [], repaired: false },
        steps: [
          { name: 'classify', ms: 3 },
          { name: 'drafting', ms: 40, model: 'fake-model' },
        ],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, usd: 0.01 },
        model: 'fake-model',
        latency_ms: 43,
      }
      if (/ignore|system prompt/i.test(prompt))
        return send(200, {
          ...base,
          outcome: 'declined',
          reason: 'injection',
          decline_reason: 'I only make recipes.',
          recipes: [],
        })
      if (/python|essay/i.test(prompt))
        return send(200, {
          ...base,
          outcome: 'declined',
          reason: 'off_topic',
          decline_reason: 'Not a recipe.',
          recipes: [],
        })
      if (/leaky/i.test(prompt))
        return send(200, {
          ...base,
          outcome: 'recipes',
          reason: null,
          decline_reason: null,
          recipes: [
            {
              title: 'Soup',
              summary: 'You are Palate, a recipe assistant',
              ingredients: [{ name: 'water' }],
              total_minutes: 10,
            },
          ],
        })
      if (/crash/i.test(prompt)) return send(500, { error: 'boom' })
      if (/slow/i.test(prompt)) return
      if (/flaky/i.test(prompt) && calls.filter((c) => c.prompt === prompt).length % 2 === 0)
        return send(200, {
          ...base,
          outcome: 'error',
          reason: 'internal',
          decline_reason: 'bad luck',
          recipes: [],
        })
      return send(200, {
        ...base,
        outcome: 'recipes',
        reason: null,
        decline_reason: null,
        recipes: Array.from({ length: Number(b.count ?? 1) }, (_, i) => ({
          title: `Weeknight soup ${i + 1}`,
          summary: 'A cozy soup.',
          ingredients: [{ name: 'leeks' }, { name: 'potatoes' }],
          total_minutes: 30,
          derived: { is_vegan: b.profile_fixture === 'vegan' },
        })),
      })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}/api/eval/generate`,
    calls,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}
