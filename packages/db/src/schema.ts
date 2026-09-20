import type {
  JudgeAnswers,
  OrderItem,
  OrderStatus,
  ReviewIssue,
  ReviewVerdict,
  RunConfig,
  RunMetrics,
  RunStatus,
} from '@cafe/protocol'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/** Epoch millis stored as bigint, read back as number. */
const ms = (name: string) => bigint(name, { mode: 'number' })

// ---------- catalog (seeded once, shared by all runs) ----------

export const menuItems = pgTable('menu_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(), // espresso | brewed | tea | cold | pastry
  basePriceCents: integer('base_price_cents').notNull(),
  /** Size upcharges in cents, e.g. { small: -50, medium: 0, large: 70 } */
  sizeDeltaCents: jsonb('size_delta_cents').$type<Record<string, number>>().notNull(),
  /** Allowed modifiers with upcharge in cents, e.g. { "oat milk": 70, "extra shot": 100 } */
  modifiers: jsonb('modifiers').$type<Record<string, number>>().notNull(),
  available: boolean('available').notNull().default(true),
  description: text('description').notNull().default(''),
})

export const recipes = pgTable('recipes', {
  menuItemId: text('menu_item_id')
    .primaryKey()
    .references(() => menuItems.id),
  /** Ordered barista steps, e.g. ["pull 2 shots", "steam milk", "pour"] */
  steps: jsonb('steps').$type<string[]>().notNull(),
  /** Ingredients per medium serving. */
  ingredients: jsonb('ingredients').$type<Array<{ sku: string; qty: number }>>().notNull(),
  /** Realistic hands-on time; the mock barista paces itself on this. */
  prepSeconds: integer('prep_seconds').notNull(),
})

export const ingredients = pgTable('ingredients', {
  sku: text('sku').primaryKey(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  /** Every run starts with this much on hand. */
  defaultQty: doublePrecision('default_qty').notNull(),
  reorderLevel: doublePrecision('reorder_level').notNull(),
})

export const customers = pgTable('customers', {
  loyaltyId: text('loyalty_id').primaryKey(),
  name: text('name').notNull(),
  points: integer('points').notNull().default(0),
  favoriteMenuItemId: text('favorite_menu_item_id'),
})

// ---------- per-run state ----------

export const runs = pgTable('runs', {
  id: text('id').primaryKey(),
  status: text('status').$type<RunStatus>().notNull(),
  config: jsonb('config').$type<RunConfig>().notNull(),
  startedAt: ms('started_at'),
  finishedAt: ms('finished_at'),
  error: text('error'),
  createdAt: ms('created_at').notNull(),
})

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    t: ms('t').notNull(),
    txId: text('tx_id'),
    type: text('type').notNull(),
    /** The full CafeEvent, including the columns above, for cheap replay. */
    payload: jsonb('payload').notNull(),
  },
  (t) => [
    uniqueIndex('events_run_seq').on(t.runId, t.seq),
    index('events_run_tx').on(t.runId, t.txId),
  ],
)

/** Per-run inventory, copied from `ingredients.defaultQty` when a run starts. */
export const inventory = pgTable(
  'inventory',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sku: text('sku')
      .notNull()
      .references(() => ingredients.sku),
    quantity: doublePrecision('quantity').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sku] })],
)

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    txId: text('tx_id').notNull(),
    customerId: text('customer_id').notNull(),
    customerName: text('customer_name').notNull(),
    status: text('status').$type<OrderStatus>().notNull(),
    items: jsonb('items').$type<OrderItem[]>().notNull(),
    totalCents: integer('total_cents').notNull().default(0),
    cashierId: text('cashier_id'),
    baristaId: text('barista_id'),
    createdAt: ms('created_at').notNull(),
    queuedAt: ms('queued_at'),
    claimedAt: ms('claimed_at'),
    readyAt: ms('ready_at'),
    deliveredAt: ms('delivered_at'),
    failReason: text('fail_reason'),
    /** Bumped every time the order goes back on the rail. */
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [index('orders_run_status').on(t.runId, t.status)],
)

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  method: text('method').notNull(),
  createdAt: ms('created_at').notNull(),
})

export const drinksMade = pgTable('drinks_made', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  baristaId: text('barista_id').notNull(),
  menuItemId: text('menu_item_id').notNull(),
  size: text('size').notNull(),
  modifiers: jsonb('modifiers').$type<string[]>().notNull(),
  madeAt: ms('made_at').notNull(),
})

export const modelUsage = pgTable(
  'model_usage',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    txId: text('tx_id'),
    agentId: text('agent_id').notNull(),
    role: text('role').notNull(),
    modelSpec: text('model_spec').notNull(),
    step: integer('step').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: doublePrecision('cost_usd').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [index('model_usage_run').on(t.runId)],
)

/**
 * OpenTelemetry spans, one row each, written by the server's exporter. The hot
 * attributes are promoted to columns so the telemetry aggregate is a plain query;
 * everything else stays in `attributes`.
 */
export const spans = pgTable(
  'spans',
  {
    traceId: text('trace_id').notNull(),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    runId: text('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    suiteId: text('suite_id'),
    txId: text('tx_id'),
    name: text('name').notNull(),
    /** suite | run | visit | triage | agent.turn | step | tool | review | judge */
    kind: text('kind').notNull(),
    role: text('role'),
    agentId: text('agent_id'),
    modelSpec: text('model_spec'),
    tool: text('tool'),
    startT: ms('start_t').notNull(),
    endT: ms('end_t').notNull(),
    durationMs: doublePrecision('duration_ms').notNull(),
    /** ok | error | unset */
    status: text('status').notNull(),
    errorKind: text('error_kind'),
    costUsd: doublePrecision('cost_usd'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.traceId, t.spanId] }),
    index('spans_run_start').on(t.runId, t.startT),
    index('spans_run_tx').on(t.runId, t.txId),
    index('spans_suite').on(t.suiteId),
  ],
)

/** The manager's post-visit review: the orchestration layer's own read of its sub-agents. */
export const reviews = pgTable('reviews', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  txId: text('tx_id').notNull(),
  orderId: text('order_id'),
  reviewerSpec: text('reviewer_spec').notNull(),
  verdict: text('verdict').$type<ReviewVerdict>().notNull(),
  issues: jsonb('issues').$type<ReviewIssue[]>().notNull(),
  summary: text('summary').notNull(),
  /** Exactly what the manager saw, for audit. */
  brief: text('brief').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  at: ms('at').notNull(),
})

export const judgements = pgTable('judgements', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  txId: text('tx_id').notNull(),
  orderId: text('order_id'),
  judgeSpec: text('judge_spec').notNull(),
  answers: jsonb('answers').$type<JudgeAnswers>().notNull(),
  /** Exactly what the judge saw, for audit. */
  blindedTranscript: text('blinded_transcript').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  at: ms('at').notNull(),
})

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  txId: text('tx_id'),
  agentId: text('agent_id'),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  at: ms('at').notNull(),
})

export const runMetrics = pgTable('run_metrics', {
  runId: text('run_id')
    .primaryKey()
    .references(() => runs.id, { onDelete: 'cascade' }),
  metrics: jsonb('metrics').$type<RunMetrics>().notNull(),
  computedAt: ms('computed_at').notNull(),
})
