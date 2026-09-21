import type { Role } from '@cafe/protocol'
import { ATTR, recordError, startSpan } from '@cafe/telemetry'
import { ulid } from 'ulid'
import { z } from 'zod'
import { type ChaosEngine, createChaos, TransientToolError } from './chaos.js'
import { scopesFor } from './roles.js'
import { BARISTA_TOOLS } from './tools/barista.js'
import { CASHIER_TOOLS } from './tools/cashier.js'
import { DomainError } from './tools/define.js'
import { MANAGER_TOOLS } from './tools/manager.js'
import type { Capability, GatewayOptions, ToolContext, ToolDef, ToolResult } from './types.js'

export const ALL_TOOLS: ToolDef[] = [...CASHIER_TOOLS, ...BARISTA_TOOLS, ...MANAGER_TOOLS]

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * The gateway is the one door between agents and the cafe's data. Every call is
 * scope-checked against the caller's capability, timed, chaos-injected, and
 * emitted as events, so the scene and the eval harness see exactly what each
 * agent did and how long it took.
 */
export class Gateway {
  readonly tools = new Map<string, ToolDef>()
  readonly chaos: ChaosEngine
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: GatewayOptions) {
    for (const t of opts.tools ?? ALL_TOOLS) this.tools.set(t.name, t)
    this.chaos = createChaos(opts.chaos)
    this.now = opts.now ?? (() => Date.now())
    this.sleep = opts.sleep ?? defaultSleep
  }

  /** Mint a capability for an agent. Scopes default to the role's slice. */
  capability(input: {
    agentId: string
    role: Role
    runId: string
    txId?: string | undefined
    scopes?: readonly string[]
  }): Capability {
    return {
      ...input,
      scopes: input.scopes ?? this.opts.roleScopes?.[input.role] ?? scopesFor(input.role),
    }
  }

  /** The tools a capability may call. This is what gets advertised to the model. */
  toolsFor(cap: Capability): ToolDef[] {
    return [...this.tools.values()].filter((t) => cap.scopes.includes(t.scope))
  }

  async call(cap: Capability, toolName: string, rawArgs: unknown): Promise<ToolResult> {
    const started = this.now()
    const callId = ulid()
    // Read txId lazily: a claim binds the barista to a visit mid-call.
    const base = () => ({ txId: cap.txId, agentId: cap.agentId, role: cap.role }) as const
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
    this.opts.emit({ type: 'agent.tool_called', ...base(), callId, tool: toolName, args })
    // Nested under whatever is active: the agent's step span when called from runAgent.
    const span = startSpan('tool', `tool ${toolName}`, {
      [ATTR.TOOL]: toolName,
      [ATTR.CALL_ID]: callId,
      [ATTR.AGENT_ID]: cap.agentId,
      [ATTR.ROLE]: cap.role,
      ...(cap.txId ? { [ATTR.TX_ID]: cap.txId } : {}),
    })

    const finish = (r: ToolResult): ToolResult => {
      const latencyMs = this.now() - started
      const out = { ...r, latencyMs } as ToolResult
      span.setAttribute(ATTR.TOOL_OK, out.ok)
      span.setAttribute(ATTR.LATENCY_MS, latencyMs)
      if (cap.txId) span.setAttribute(ATTR.TX_ID, cap.txId)
      if (!out.ok) {
        span.setAttribute(ATTR.TOOL_CODE, out.code)
        recordError(span, new Error(out.error), out.code)
      }
      span.end()
      this.opts.emit(
        out.ok
          ? {
              type: 'agent.tool_returned',
              ...base(),
              callId,
              tool: toolName,
              ok: true,
              latencyMs,
              result: out.result,
            }
          : {
              type: 'agent.tool_returned',
              ...base(),
              callId,
              tool: toolName,
              ok: false,
              latencyMs,
              error: out.error,
            },
      )
      return out
    }

    const tool = this.tools.get(toolName)
    if (tool) span.setAttribute(ATTR.TOOL_SCOPE, tool.scope)
    if (!tool)
      return finish({
        ok: false,
        code: 'unknown_tool',
        error: `Unknown tool "${toolName}"`,
        latencyMs: 0,
      })

    if (!cap.scopes.includes(tool.scope)) {
      this.opts.emit({
        type: 'agent.scope_violation',
        ...base(),
        tool: toolName,
        allowedScopes: [...cap.scopes],
      })
      return finish({
        ok: false,
        code: 'scope',
        error: `Your role (${cap.role}) is not permitted to call ${toolName}. Ask the right team member instead.`,
        latencyMs: 0,
      })
    }

    const parsed = tool.input.safeParse(args)
    if (!parsed.success) {
      return finish({
        ok: false,
        code: 'invalid_args',
        error: `Invalid arguments: ${z.prettifyError(parsed.error)}`,
        latencyMs: 0,
      })
    }

    const extra = this.chaos.extraLatencyMs()
    if (extra > 0) await this.sleep(extra)

    const ctx: ToolContext = {
      store: this.opts.store,
      cap,
      emit: this.opts.emit,
      now: this.now,
      services: this.opts.services ?? {},
    }
    try {
      this.chaos.maybeFail(toolName)
      const result = await tool.handler(parsed.data, ctx)
      return finish({ ok: true, result: result ?? null, latencyMs: 0 })
    } catch (err) {
      if (err instanceof TransientToolError)
        return finish({ ok: false, code: 'transient', error: err.message, latencyMs: 0 })
      if (err instanceof DomainError)
        return finish({ ok: false, code: 'domain', error: err.message, latencyMs: 0 })
      const message = err instanceof Error ? err.message : String(err)
      return finish({ ok: false, code: 'domain', error: message, latencyMs: 0 })
    }
  }
}
