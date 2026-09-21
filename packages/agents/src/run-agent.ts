import type { CafeStore } from '@cafe/db'
import type { Capability, ChaosEngine, Emit, Gateway } from '@cafe/mcp-gateway'
import { costUsd, type ModelRegistry } from '@cafe/models'
import type { Budget, Role, Station } from '@cafe/protocol'
import {
  ATTR,
  type Context,
  contextFor,
  inSpan,
  markOk,
  context as otelContext,
  recordError,
  type Span,
  startSpan,
  trace,
} from '@cafe/telemetry'
import {
  generateText,
  jsonSchema,
  type ModelMessage,
  NoSuchToolError,
  stepCountIs,
  type ToolSet,
  tool,
} from 'ai'

export interface AgentSpec {
  agentId: string
  role: Exclude<Role, 'customer' | 'judge'>
  name: string
  modelSpec: string
  sprite: string
  station: Station
  systemPrompt: string
}

export type AgentOutcome = 'completed' | 'crashed' | 'budget_exceeded' | 'timeout' | 'model_error'

export interface AgentToolCall {
  tool: string
  ok: boolean
  latencyMs: number
  code?: string | undefined
}

export interface AgentRunResult {
  outcome: AgentOutcome
  text: string
  steps: number
  toolCalls: AgentToolCall[]
  scopeViolations: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Wall time for the whole agent turn. */
  durationMs: number
  /** Model-only latency per step. */
  modelLatenciesMs: number[]
  /** The full exchange, for the judge and the inspector. */
  messages: ModelMessage[]
  error?: string | undefined
}

export interface RunAgentInput {
  agent: AgentSpec
  task: string
  /** Structured facts the agent needs (customer id/name, loyalty id). Embedded verbatim in the system prompt. */
  context: Record<string, unknown>
  runId: string
  txId?: string | undefined
  gateway: Gateway
  registry: ModelRegistry
  store: CafeStore
  emit: Emit
  budget: Budget
  chaos: ChaosEngine
  /** Returns true when the run has already spent its USD budget. */
  overBudget: () => boolean
  now?: () => number
  /** Extra scopes beyond the role default (used by tests and future experiments). */
  extraScopes?: string[] | undefined
  /** OpenTelemetry parent for this turn's span (the visit, or the run for a barista loop). */
  parentContext?: Context | Span | null | undefined
}

class AgentCrashError extends Error {}
class BudgetExceededError extends Error {}

/**
 * Run one agent turn: the model loops over its tool slice until it produces a
 * final answer or hits a guard rail. Every tool call goes through the gateway,
 * so scope, chaos, latency, and events are handled in one place.
 */
export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const { agent, gateway, registry, emit, budget, chaos } = input
  const now = input.now ?? (() => Date.now())
  const started = now()
  // txId is read lazily because a barista's capability binds to a visit when it claims a ticket.
  const base = () => ({ txId: cap.txId, agentId: agent.agentId, role: agent.role }) as const

  const cap: Capability = gateway.capability({
    agentId: agent.agentId,
    role: agent.role,
    runId: input.runId,
    txId: input.txId,
    ...(input.extraScopes
      ? {
          scopes: [
            ...gateway.capability({ agentId: agent.agentId, role: agent.role, runId: input.runId })
              .scopes,
            ...input.extraScopes,
          ],
        }
      : {}),
  })

  // One span per turn, one per model step under it; tool spans nest under the live step.
  const turn = startSpan(
    'agent.turn',
    `${agent.role} turn`,
    {
      [ATTR.AGENT_ID]: agent.agentId,
      [ATTR.ROLE]: agent.role,
      [ATTR.MODEL_SPEC]: agent.modelSpec,
      ...(cap.txId ? { [ATTR.TX_ID]: cap.txId } : {}),
    },
    input.parentContext,
  )
  const turnContext = trace.setSpan(contextFor(input.parentContext), turn)
  let stepSpan: Span | null = null
  const bindTx = () => {
    // A barista's claim binds the turn to a visit mid-way; reflect it on the open spans.
    if (!cap.txId) return
    turn.setAttribute(ATTR.TX_ID, cap.txId)
    stepSpan?.setAttribute(ATTR.TX_ID, cap.txId)
  }

  const toolCalls: AgentToolCall[] = []
  /** DB writes we do not want to block the model loop on, but must finish before we return. */
  const pending: Promise<unknown>[] = []
  let scopeViolations = 0
  let inputTokens = 0
  let outputTokens = 0
  let steps = 0
  const modelLatenciesMs: number[] = []
  const abort = new AbortController()
  let abortReason: AgentOutcome | null = null
  let crashMessage: string | undefined
  const bail = (reason: AgentOutcome) => {
    abortReason ??= reason
    abort.abort()
  }
  const timer = setTimeout(() => bail('timeout'), budget.agentTimeoutMs)

  const callGateway = async (name: string, args: unknown) => {
    if (chaos.shouldCrash(agent.role)) {
      // The SDK turns thrown tool errors into tool-error parts, so abort the loop ourselves.
      crashMessage = `${agent.name} dropped everything (simulated crash)`
      bail('crashed')
      throw new AgentCrashError(crashMessage)
    }
    const r = stepSpan
      ? await inSpan(stepSpan, () => gateway.call(cap, name, args))
      : await otelContext.with(turnContext, () => gateway.call(cap, name, args))
    bindTx()
    toolCalls.push({
      tool: name,
      ok: r.ok,
      latencyMs: r.latencyMs,
      code: r.ok ? undefined : r.code,
    })
    if (!r.ok && r.code === 'scope') scopeViolations += 1
    // Hand errors back as data so the model can recover instead of the loop dying.
    return r.ok ? (r.result ?? null) : { error: r.error, code: r.code }
  }

  const tools: ToolSet = {}
  for (const def of gateway.toolsFor(cap)) {
    tools[def.name] = tool({
      description: def.description,
      // a remote MCP tool advertises its own JSON Schema; built-ins their zod schema
      inputSchema: def.inputJsonSchema ? jsonSchema(def.inputJsonSchema) : def.input,
      execute: (args: unknown) => callGateway(def.name, args),
    })
  }

  const system = `${agent.systemPrompt}\n\n<context>${JSON.stringify(input.context)}</context>`
  const model = registry.languageModel(agent.modelSpec)

  let outcome: AgentOutcome = 'completed'
  let text = ''
  let error: string | undefined
  let messages: ModelMessage[] = []
  let stepStartedAt = now()

  try {
    const result = await otelContext.with(turnContext, () =>
      generateText({
        model,
        system,
        prompt: input.task,
        tools,
        stopWhen: stepCountIs(budget.maxStepsPerAgent),
        abortSignal: abort.signal,
        maxRetries: 1,
        onStepStart: () => {
          steps += 1
          stepStartedAt = now()
          stepSpan = startSpan(
            'step',
            `${agent.role} step ${steps}`,
            {
              [ATTR.AGENT_ID]: agent.agentId,
              [ATTR.ROLE]: agent.role,
              [ATTR.MODEL_SPEC]: agent.modelSpec,
              [ATTR.STEP]: steps,
              ...(cap.txId ? { [ATTR.TX_ID]: cap.txId } : {}),
            },
            turn,
          )
          emit({ type: 'agent.thinking', ...base(), step: steps })
        },
        onLanguageModelCallEnd: (e) => {
          modelLatenciesMs.push(Math.max(0, now() - stepStartedAt))
          const u = e.usage
          inputTokens += u?.inputTokens ?? 0
          outputTokens += u?.outputTokens ?? 0
        },
        onStepFinish: (step) => {
          const stepIn = step.usage.inputTokens ?? 0
          const stepOut = step.usage.outputTokens ?? 0
          const latencyMs = modelLatenciesMs[modelLatenciesMs.length - 1] ?? 0
          emit({
            type: 'model.usage',
            ...base(),
            modelSpec: agent.modelSpec,
            step: steps,
            inputTokens: stepIn,
            outputTokens: stepOut,
            costUsd: costUsd(agent.modelSpec, stepIn, stepOut),
            latencyMs,
          })
          pending.push(
            input.store.usage.record({
              runId: input.runId,
              txId: cap.txId,
              agentId: agent.agentId,
              role: agent.role,
              modelSpec: agent.modelSpec,
              step: steps,
              inputTokens: stepIn,
              outputTokens: stepOut,
              costUsd: costUsd(agent.modelSpec, stepIn, stepOut),
              latencyMs,
              now: now(),
            }),
          )
          // A call to a tool the model was never given is flagged on the tool-call part as invalid.
          // Route it through the gateway anyway so it is recorded as a scope violation / unknown tool
          // (the model already received the SDK's "unavailable tool" message as the tool result).
          for (const part of step.content) {
            if (
              part.type === 'tool-call' &&
              part.invalid &&
              NoSuchToolError.isInstance(part.error)
            ) {
              const args = (
                part.input && typeof part.input === 'object' ? part.input : {}
              ) as Record<string, unknown>
              pending.push(callGateway(part.toolName, args).catch(() => undefined))
            }
          }
          if (step.text.trim()) emit({ type: 'agent.spoke', ...base(), text: step.text.trim() })
          if (stepSpan) {
            stepSpan.setAttributes({
              [ATTR.INPUT_TOKENS]: stepIn,
              [ATTR.OUTPUT_TOKENS]: stepOut,
              [ATTR.COST_USD]: costUsd(agent.modelSpec, stepIn, stepOut),
              [ATTR.LATENCY_MS]: latencyMs,
            })
            stepSpan.end()
            stepSpan = null
          }
          if (inputTokens + outputTokens > budget.maxTokensPerAgent || input.overBudget())
            bail('budget_exceeded')
        },
      }),
    )
    text = result.text
    messages = [
      { role: 'system', content: system },
      { role: 'user', content: input.task },
      ...result.response.messages,
    ]
    if (abortReason === 'crashed') {
      outcome = 'crashed'
      error = crashMessage
    } else if (abortReason) outcome = abortReason
    else if (steps >= budget.maxStepsPerAgent && result.finishReason === 'tool-calls') {
      outcome = 'budget_exceeded'
      error = `Hit the ${budget.maxStepsPerAgent}-step limit without finishing`
    }
  } catch (err) {
    if (err instanceof AgentCrashError || abortReason === 'crashed') {
      outcome = 'crashed'
      error = crashMessage ?? (err instanceof Error ? err.message : 'crashed')
    } else if (err instanceof BudgetExceededError || abortReason === 'budget_exceeded') {
      outcome = 'budget_exceeded'
      error = err instanceof Error ? err.message : 'budget exceeded'
    } else if (abortReason === 'timeout') {
      outcome = 'timeout'
      error = `No answer within ${budget.agentTimeoutMs}ms`
    } else {
      outcome = 'model_error'
      error = err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timer)
    // A bail mid-step leaves the step span open; close it under the turn's verdict.
    if (stepSpan) {
      const open: Span = stepSpan
      if (outcome !== 'completed') recordError(open, new Error(error ?? outcome), outcome)
      open.end()
      stepSpan = null
    }
  }

  if (outcome !== 'completed') {
    const kind =
      outcome === 'crashed'
        ? 'crash'
        : outcome === 'budget_exceeded'
          ? 'budget'
          : outcome === 'timeout'
            ? 'timeout'
            : 'model'
    emit({
      type: 'agent.error',
      ...base(),
      kind,
      message: error ?? outcome,
      retryable: outcome === 'crashed' || outcome === 'timeout',
    })
    pending.push(
      input.store.incidents.record({
        runId: input.runId,
        txId: cap.txId,
        agentId: agent.agentId,
        kind,
        message: error ?? outcome,
        now: now(),
      }),
    )
  }
  await Promise.allSettled(pending)

  turn.setAttributes({
    [ATTR.OUTCOME]: outcome,
    [ATTR.STEP]: steps,
    [ATTR.INPUT_TOKENS]: inputTokens,
    [ATTR.OUTPUT_TOKENS]: outputTokens,
    [ATTR.COST_USD]: costUsd(agent.modelSpec, inputTokens, outputTokens),
  })
  if (outcome === 'completed') markOk(turn)
  else recordError(turn, new Error(error ?? outcome), outcome)
  turn.end()

  return {
    outcome,
    text,
    steps,
    toolCalls,
    scopeViolations,
    inputTokens,
    outputTokens,
    costUsd: costUsd(agent.modelSpec, inputTokens, outputTokens),
    durationMs: now() - started,
    modelLatenciesMs,
    messages,
    error,
  }
}
