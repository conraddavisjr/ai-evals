import type { CafeStore } from '@cafe/db'
import type { CafeEventInput, Chaos, Role } from '@cafe/protocol'
import type { z } from 'zod'

/** Sink for events. The server's EventBus fills in id/runId/seq/t and persists. */
export type Emit = (event: CafeEventInput) => void

/**
 * A capability token is what an agent presents on every call. The gateway trusts
 * nothing else: the model may be told about a tool slice, but the token decides.
 */
export interface Capability {
  agentId: string
  role: Role
  runId: string
  /** The visit this work belongs to. A barista's is bound when it claims a ticket. */
  txId?: string | undefined
  scopes: readonly string[]
}

/** Services the gateway needs that live outside the database (the live staff pool). */
export interface StaffingService {
  list(): Array<{ agentId: string; role: Role; station: string; busy: boolean }>
  spawnBarista(): Promise<{ agentId: string }>
}

export interface GatewayServices {
  staffing?: StaffingService
}

export interface ToolContext {
  store: CafeStore
  cap: Capability
  emit: Emit
  now: () => number
  services: GatewayServices
}

// biome-ignore lint/suspicious/noExplicitAny: tool registry holds heterogeneous schemas
export interface ToolDef<In extends z.ZodObject<any> = z.ZodObject<any>, Out = unknown> {
  /** Dotted name, e.g. "orders.create". */
  name: string
  /** The scope an agent must hold to call it, e.g. "orders:create". */
  scope: string
  description: string
  input: In
  handler: (args: z.infer<In>, ctx: ToolContext) => Promise<Out>
}

export type ToolResult =
  | { ok: true; result: unknown; latencyMs: number }
  | { ok: false; error: string; code: ToolErrorCode; latencyMs: number }

export type ToolErrorCode = 'scope' | 'unknown_tool' | 'invalid_args' | 'transient' | 'domain'

export interface GatewayOptions {
  store: CafeStore
  emit: Emit
  chaos?: Partial<Chaos> | undefined
  now?: () => number
  services?: GatewayServices
  /** Sleep implementation, injectable so tests can run instantly. */
  sleep?: (ms: number) => Promise<void>
}
