import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  LanguageModelV4,
} from '@ai-sdk/provider'
import { isMockSpec, type MockPacing, parseModelSpec } from '@cafe/protocol'
import { languageModelAsEvaluationModel } from './llm-evaluation-adapter.js'
import { MockEvaluationModel } from './mock/evaluation.js'
import { MockLanguageModel } from './mock/language.js'
import { createPacer, INSTANT_PACING, type Pacer } from './mock/pacing.js'

export class LiveModelsDisabledError extends Error {
  constructor(spec: string) {
    super(
      `Refusing to use live model "${spec}": set CAFE_ALLOW_LIVE_MODELS=true (or pass allowLive) to spend money. Mock specs (mock:*) are always allowed.`,
    )
  }
}

export interface RegistryOptions {
  /** Explicit override; otherwise read from CAFE_ALLOW_LIVE_MODELS. */
  allowLive?: boolean | undefined
  /** Pacing for mock models. Defaults to instant. */
  mockPacing?: MockPacing | undefined
  mockSeed?: number | undefined
  /** Hook the runtime uses to make a specific mock barista hang. */
  mockBeforeStep?: ((info: { persona: string; step: number }) => Promise<void>) | undefined
}

/**
 * One place that turns a ModelSpec string into a model object. Every role, the
 * judge, and the triage step go through here, so swapping Claude for Gemini,
 * GPT, an Ollama model, or Jev is a config edit and nothing else.
 */
export class ModelRegistry {
  private readonly allowLive: boolean
  private readonly pacer: Pacer
  private providers: {
    anthropic?: ReturnType<typeof createAnthropic>
    openai?: ReturnType<typeof createOpenAI>
    google?: ReturnType<typeof createGoogleGenerativeAI>
    gateway?: ReturnType<typeof createGateway>
    ollama?: ReturnType<typeof createOpenAICompatible>
  } = {}

  constructor(private readonly opts: RegistryOptions = {}) {
    this.allowLive = opts.allowLive ?? process.env.CAFE_ALLOW_LIVE_MODELS === 'true'
    this.pacer = createPacer(opts.mockPacing ?? INSTANT_PACING, opts.mockSeed ?? 1)
  }

  isLive(spec: string): boolean {
    return !isMockSpec(spec)
  }

  private guard(spec: string) {
    if (this.isLive(spec) && !this.allowLive) throw new LiveModelsDisabledError(spec)
  }

  languageModel(spec: string): LanguageModelV4 {
    const p = parseModelSpec(spec)
    if (p.provider === 'mock') {
      return new MockLanguageModel({
        persona: p.model,
        pacer: this.pacer,
        ...(this.opts.mockBeforeStep ? { beforeStep: this.opts.mockBeforeStep } : {}),
      })
    }
    this.guard(spec)
    switch (p.provider) {
      case 'anthropic':
        return this.anthropic()(p.model) as LanguageModelV4
      case 'openai':
        return this.openai()(p.model) as LanguageModelV4
      case 'google':
        return this.google()(p.model) as LanguageModelV4
      case 'gateway':
        return this.gateway()(p.model) as LanguageModelV4
      case 'ollama':
        return this.ollama()(p.model) as LanguageModelV4
    }
  }

  /**
   * Evaluation models answer typed questions (boolean/choice/score) about a state.
   * TypeSafe Jev is native; Anthropic/OpenAI/Google use the SDK's structured-output
   * adapters; anything else is wrapped by our own adapter.
   */
  evaluationModel(spec: string): EvaluationModelV4 {
    const p = parseModelSpec(spec)
    if (p.provider === 'mock') return new MockEvaluationModel(p.model, this.pacer)
    this.guard(spec)
    switch (p.provider) {
      case 'anthropic':
        return this.anthropic().evaluationModel(p.model)
      case 'openai':
        return this.openai().evaluationModel(p.model)
      case 'google':
        return this.google().evaluationModel(p.model)
      case 'gateway':
        // Jev ids on the gateway are "typesafe-ai/jev-latest"; accept the short form too.
        return this.gateway().evaluationModel(
          p.model === 'typesafe-ai/jev' ? 'typesafe-ai/jev-latest' : p.model,
        )
      case 'ollama':
        return languageModelAsEvaluationModel(this.ollama()(p.model) as LanguageModelV4)
    }
  }

  private anthropic() {
    // An org-level key must name a workspace; a workspace-scoped key does not need the header.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID
    this.providers.anthropic ??= createAnthropic({
      apiKey: need('ANTHROPIC_API_KEY'),
      ...(workspace ? { headers: { 'anthropic-workspace-id': workspace } } : {}),
    })
    return this.providers.anthropic
  }
  private openai() {
    this.providers.openai ??= createOpenAI({ apiKey: need('OPENAI_API_KEY') })
    return this.providers.openai
  }
  private google() {
    this.providers.google ??= createGoogleGenerativeAI({
      apiKey: need('GOOGLE_GENERATIVE_AI_API_KEY'),
    })
    return this.providers.google
  }
  private gateway() {
    this.providers.gateway ??= createGateway({ apiKey: need('AI_GATEWAY_API_KEY') })
    return this.providers.gateway
  }
  private ollama() {
    this.providers.ollama ??= createOpenAICompatible({
      name: 'ollama',
      baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:11434/v1',
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? 'ollama',
    })
    return this.providers.ollama
  }
}

function need(env: string): string {
  const v = process.env[env]
  if (!v) throw new Error(`${env} is not set; add it to .env to use this provider`)
  return v
}
