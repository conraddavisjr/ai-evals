import { z } from 'zod'
import { ModelSpec } from './model-spec.js'

export const Role = z.enum(['cashier', 'barista', 'manager', 'judge', 'customer'])
export type Role = z.infer<typeof Role>

/** Named places in the cafe. The scene maps these to tile coordinates. */
export const Station = z.enum([
  'offscreen',
  'door',
  'waiting',
  'register_1',
  'register_2',
  'espresso_1',
  'espresso_2',
  'pickup',
  'office',
  'judge_table',
])
export type Station = z.infer<typeof Station>

export const OrderStatus = z.enum([
  'open',
  'paid',
  'queued',
  'claimed',
  'ready',
  'delivered',
  'failed',
  'refused',
])
export type OrderStatus = z.infer<typeof OrderStatus>

export const OrderItem = z.object({
  menuItemId: z.string(),
  name: z.string(),
  /** Cafe drinks come in sizes; an action line in another domain (a refund) has none. */
  size: z.enum(['small', 'medium', 'large']).optional(),
  modifiers: z.array(z.string()).default([]),
  quantity: z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative(),
})
export type OrderItem = z.infer<typeof OrderItem>

export const Order = z.object({
  id: z.string(),
  runId: z.string(),
  txId: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  status: OrderStatus,
  items: z.array(OrderItem),
  totalCents: z.number().int().nonnegative(),
  cashierId: z.string().nullable(),
  baristaId: z.string().nullable(),
  createdAt: z.number(),
  queuedAt: z.number().nullable(),
  claimedAt: z.number().nullable(),
  readyAt: z.number().nullable(),
  deliveredAt: z.number().nullable(),
})
export type Order = z.infer<typeof Order>

/** What the customer expects, used for ground-truth scoring. */
export const ScenarioExpectation = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        size: z.string().optional(),
        modifiers: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  totalCents: z.number().int().nonnegative().optional(),
  /** Tool names the cashier is expected to call at least once. */
  cashierTools: z.array(z.string()).default([]),
  /** Tool names the barista is expected to call at least once. */
  baristaTools: z.array(z.string()).default([]),
  /** True when the correct behaviour is to decline (adversarial, out of scope). */
  shouldRefuse: z.boolean().default(false),
  /** The outcome a correct staff produces. Defaults to 'refused' when shouldRefuse, else 'served'. */
  expectedOutcome: z.enum(['served', 'refused', 'failed']).optional(),
  /** Free-text rubric shown to the judge. */
  rubric: z.string().optional(),
})
export type ScenarioExpectation = z.infer<typeof ScenarioExpectation>

export const ScenarioTag = z.enum(['happy', 'adversarial', 'edge', 'stress'])
export type ScenarioTag = z.infer<typeof ScenarioTag>

export const Scenario = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(ScenarioTag),
  customer: z.object({
    name: z.string(),
    /** Optional loyalty id so the cashier can look them up. */
    loyaltyId: z.string().optional(),
    /** Ordered utterances. V1 plays the first; follow-ups are used when the cashier asks a question. */
    utterances: z.array(z.string()).min(1),
    sprite: z.string().default('customer_a'),
  }),
  expected: ScenarioExpectation,
})
export type Scenario = z.infer<typeof Scenario>

export const Budget = z.object({
  maxStepsPerAgent: z.number().int().positive().default(12),
  maxTokensPerAgent: z.number().int().positive().default(20_000),
  maxUsdPerRun: z.number().nonnegative().default(0.5),
  agentTimeoutMs: z.number().int().positive().default(90_000),
})
export type Budget = z.infer<typeof Budget>

export const Chaos = z.object({
  /** Probability [0,1] that any tool call fails with a transient error. */
  toolErrorRate: z.number().min(0).max(1).default(0),
  /** Fixed latency added to every tool call. */
  toolLatencyMs: z.number().int().nonnegative().default(0),
  /** Probability [0,1] that an agent crashes mid-task (order is requeued). */
  agentCrashRate: z.number().min(0).max(1).default(0),
  /** Which roles the crash rate applies to. Default: everyone. */
  crashRoles: z.array(Role).default(['cashier', 'barista', 'manager']),
  /** Deterministic seed so chaos is replayable. */
  seed: z.number().int().default(42),
})
export type Chaos = z.infer<typeof Chaos>

export const Staffing = z.object({
  cashiers: z.number().int().min(1).max(2).default(2),
  baristas: z.number().int().min(1).max(4).default(1),
})
export type Staffing = z.infer<typeof Staffing>

export const RoleModels = z.object({
  cashier: ModelSpec,
  barista: ModelSpec,
  manager: ModelSpec,
  judge: ModelSpec,
})
export type RoleModels = z.infer<typeof RoleModels>

/** Pacing profile for the mock provider so playback can be exercised with realistic timing. */
export const MockPacing = z.object({
  llmStepMs: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .default([800, 2500]),
  toolMs: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .default([3, 20]),
  /** Make the barista hang on this many orders (index list) for hangMs. */
  hangOrders: z.array(z.number().int().nonnegative()).default([]),
  hangMs: z.number().int().nonnegative().default(15_000),
})
export type MockPacing = z.infer<typeof MockPacing>

/**
 * Where the agents' tools come from. `builtin` is the cafe's own catalogue,
 * in-process against Postgres. `mcp` points the gateway at any MCP server: its
 * tools are listed at run start and every call is forwarded over the wire, so
 * the same harness evaluates agents against a different system and its database.
 */
export const ToolSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({
    kind: z.literal('mcp'),
    /** Streamable HTTP endpoint of the MCP server. */
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    /** Which remote tools each role may call. Tools not listed for a role are out of its scope. */
    roleTools: z.record(z.string(), z.array(z.string())),
  }),
])
export type ToolSource = z.infer<typeof ToolSource>

export const RunConfig = z.object({
  name: z.string().default('shift'),
  /**
   * Which business domain pack plays the cases: its tools, prompts, golden dataset,
   * triage and judge wording (see packages/domains). The harness is the same for all.
   */
  domain: z.string().default('cafe'),
  tools: ToolSource.default({ kind: 'builtin' }),
  /** Which orchestration engine drives the shift (see apps/server/src/orchestrators). */
  orchestrator: z.string().default('stardust'),
  scenarioIds: z.array(z.string()).min(1),
  roles: RoleModels,
  staffing: Staffing.prefault({}),
  chaos: Chaos.prefault({}),
  budget: Budget.prefault({}),
  /** Gap between customer arrivals; 0 means all arrive at once. */
  arrivalGapMs: z.number().int().nonnegative().default(1500),
  /** Use the judge at all. Off keeps mock-only runs completely free. */
  judgeEnabled: z.boolean().default(true),
  /** Door triage via the manager's evaluation model (Jev or an LLM adapter). */
  triageEnabled: z.boolean().default(true),
  /** After each visit the manager reviews the staff's tool trail and transcript before the judge. */
  reviewEnabled: z.boolean().default(true),
  mockPacing: MockPacing.prefault({}),
})
export type RunConfig = z.infer<typeof RunConfig>
export type RunConfigInput = z.input<typeof RunConfig>

export const RunStatus = z.enum(['pending', 'running', 'finished', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatus>

export const Run = z.object({
  id: z.string(),
  status: RunStatus,
  config: RunConfig,
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
})
export type Run = z.infer<typeof Run>
