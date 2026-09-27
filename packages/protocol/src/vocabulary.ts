import type { Beat } from './beats.js'

/**
 * The words a domain pack uses for the harness's moving parts. The harness itself
 * is always the same (a case arrives, the orchestrator triages it, agent 1 does
 * intake and puts a work item on the queue, agent 2 fulfils it, the orchestrator
 * reviews, the judge scores); only these words and the pack's tools, prompts and
 * golden dataset change. Pure data, so the web reads it without a round trip.
 *
 * Internal keys stay stable across domains (roles `cashier`/`barista`/`manager`,
 * events `order.*`/`customer.*`, outcomes `served`/`refused`) so stored runs replay;
 * every label a person reads comes from here.
 */
export interface DomainVocabulary {
  /** The business being simulated: "Stardust Cafe". */
  business: string
  /** Who brings a case: "customer". */
  requester: string
  /** The unit of work agent 1 opens and agent 2 fulfils: "order", "ticket". */
  workItem: string
  /** A line on a work item: "item", "action". */
  line: string
  /** Where queued work waits: "the rail", "the queue". */
  queue: string
  /** Agent roles, by internal key. */
  roles: { cashier: string; barista: string; manager: string }
  /** One line on what each agent does, for the pipeline diagram and its panels. */
  agentBlurbs: { cashier: string; barista: string }
  /** Outcome labels, by internal key. */
  outcomes: { served: string; refused: string; failed: string; abandoned: string }
  /** Waterfall and beat labels, by beat. */
  beats: Record<Beat, string>
  /** Money on a work item reads as a price (cafe) or a payout (refunds). */
  moneyLabel: string
  /** Whether the domain's scenes (Village, Pixel) can draw it; Trace draws every domain. */
  hasScene: boolean
}

export const DOMAIN_VOCABULARY: Record<string, DomainVocabulary> = {
  cafe: {
    business: 'Stardust Cafe',
    requester: 'customer',
    workItem: 'order',
    line: 'item',
    queue: 'the rail',
    roles: { cashier: 'cashier', barista: 'barista', manager: 'manager' },
    agentBlurbs: {
      cashier:
        'Takes the order: menu lookup, customer lookup, create and fill the order, charge, put the ticket on the rail. Refuses what it should.',
      barista:
        'Pulls the next ticket, fetches the recipe, consumes inventory, logs the drink, marks it ready and calls the customer.',
    },
    outcomes: { served: 'served', refused: 'refused', failed: 'failed', abandoned: 'abandoned' },
    beats: {
      arrive: 'arrive',
      order_taken: 'cashier',
      queued: 'queue wait',
      making: 'barista',
      called_out: 'pickup',
      left: 'leave',
      judged: 'judge',
    },
    moneyLabel: 'total',
    hasScene: true,
  },
  support: {
    business: 'Brightside Goods support desk',
    requester: 'customer',
    workItem: 'ticket',
    line: 'action',
    queue: 'the fulfilment queue',
    roles: { cashier: 'support rep', barista: 'fulfilment', manager: 'team lead' },
    agentBlurbs: {
      cashier:
        'Handles the conversation: looks up the account and purchase, checks the returns policy, opens a ticket with the right action and submits it. Declines what it should.',
      barista:
        'Claims the next approved ticket, pays out refunds and store credit or ships replacements, resolves the ticket and notifies the customer.',
    },
    outcomes: {
      served: 'resolved',
      refused: 'declined',
      failed: 'failed',
      abandoned: 'abandoned',
    },
    beats: {
      arrive: 'arrive',
      order_taken: 'intake',
      queued: 'queue wait',
      making: 'fulfilment',
      called_out: 'notify',
      left: 'close',
      judged: 'judge',
    },
    moneyLabel: 'payout',
    hasScene: false,
  },
}

/**
 * Another project's AI evaluated over HTTP (packages/targets). The app's reported
 * phases map onto the same pipeline: its pre-classifier is the router, its first
 * model call is agent 1, and review or repair is agent 2. A run's config pack can
 * rename any of these (TargetRunInfo.vocabulary).
 */
const TARGET_VOCABULARY: DomainVocabulary = {
  business: 'App under test',
  requester: 'user',
  workItem: 'response',
  line: 'result',
  queue: 'review',
  roles: { cashier: 'drafter', barista: 'reviewer', manager: 'router' },
  agentBlurbs: {
    cashier: 'The app’s first model call: it drafts the answer to the request.',
    barista: 'The app’s review and repair: checks the draft and fixes what breaks a rule.',
  },
  outcomes: { served: 'served', refused: 'declined', failed: 'failed', abandoned: 'abandoned' },
  beats: {
    arrive: 'arrive',
    order_taken: 'draft',
    queued: 'hand-off',
    making: 'review',
    called_out: 'deliver',
    left: 'done',
    judged: 'judge',
  },
  moneyLabel: 'cost',
  hasScene: true,
}
DOMAIN_VOCABULARY.target = TARGET_VOCABULARY

export const DEFAULT_DOMAIN = 'cafe'

/** A domain's words, with a run's own overrides (a config pack's vocabulary) on top. */
export function vocabularyFor(
  domain: string | null | undefined,
  override?: Record<string, unknown> | null,
): DomainVocabulary {
  const base =
    DOMAIN_VOCABULARY[domain ?? DEFAULT_DOMAIN] ??
    (DOMAIN_VOCABULARY[DEFAULT_DOMAIN] as DomainVocabulary)
  if (!override || !Object.keys(override).length) return base
  const o = override as Partial<DomainVocabulary>
  return {
    ...base,
    ...o,
    roles: { ...base.roles, ...(o.roles ?? {}) },
    agentBlurbs: { ...base.agentBlurbs, ...(o.agentBlurbs ?? {}) },
    outcomes: { ...base.outcomes, ...(o.outcomes ?? {}) },
    beats: { ...base.beats, ...(o.beats ?? {}) },
  }
}
