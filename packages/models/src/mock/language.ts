import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import { type MockBrain, PERSONAS, parsePrompt } from './brains.js'
import { createPacer, INSTANT_PACING, type Pacer, sleep } from './pacing.js'

export interface MockLanguageModelOptions {
  persona: string
  pacer?: Pacer
  /** Called before each step; lets the runtime inject a hang for a specific order. */
  beforeStep?: (info: { persona: string; step: number }) => Promise<void>
}

let callCounter = 0
const estimateTokens = (s: string) => Math.max(1, Math.round(s.length / 4))

/**
 * A LanguageModelV4 whose "intelligence" is a scripted persona. Zero cost, fully
 * deterministic, realistic pacing, and it exercises the real tool loop in `ai`.
 */
export class MockLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'mock'
  readonly modelId: string
  readonly supportedUrls = {}
  private readonly brain: MockBrain
  private readonly pacer: Pacer
  private step = 0

  constructor(private readonly opts: MockLanguageModelOptions) {
    const factory = PERSONAS[opts.persona]
    if (!factory)
      throw new Error(
        `Unknown mock persona "${opts.persona}". Known: ${Object.keys(PERSONAS).join(', ')}`,
      )
    this.brain = factory()
    this.modelId = `mock:${opts.persona}`
    this.pacer = opts.pacer ?? createPacer(INSTANT_PACING)
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    this.step += 1
    options.abortSignal?.throwIfAborted()
    await this.opts.beforeStep?.({ persona: this.opts.persona, step: this.step })
    await sleep(this.pacer.llmStep(), options.abortSignal)
    options.abortSignal?.throwIfAborted()
    const ctx = parsePrompt(options.prompt)
    const action = this.brain(ctx)
    const inputTokens = estimateTokens(JSON.stringify(options.prompt))

    const usage = {
      inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    }
    if (action.kind === 'text') {
      usage.outputTokens = {
        total: estimateTokens(action.text),
        text: estimateTokens(action.text),
        reasoning: 0,
      }
      return {
        content: [{ type: 'text', text: action.text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }
    }
    const input = JSON.stringify(action.args)
    usage.outputTokens = {
      total: estimateTokens(input) + 8,
      text: estimateTokens(input) + 8,
      reasoning: 0,
    }
    // Emit the call even if the tool is not advertised: that is exactly how a real model
    // misbehaves, and the runtime/gateway must handle it (scope_violation / unknown tool).
    return {
      content: [
        {
          type: 'tool-call',
          toolCallId: `mock-call-${++callCounter}`,
          toolName: action.name,
          input,
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      usage,
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const result = await this.doGenerate(options)
    const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }]
    for (const [i, c] of result.content.entries()) {
      if (c.type === 'text') {
        parts.push(
          { type: 'text-start', id: `t${i}` },
          { type: 'text-delta', id: `t${i}`, delta: c.text },
          { type: 'text-end', id: `t${i}` },
        )
      } else if (c.type === 'tool-call') {
        parts.push(c)
      }
    }
    parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason })
    return {
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const p of parts) controller.enqueue(p)
          controller.close()
        },
      }),
    }
  }
}
