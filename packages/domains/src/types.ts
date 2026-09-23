import type { CafeStore } from '@cafe/db'
import type { JudgeQuestions, ReviewQuestions, TriageQuestions } from '@cafe/evals'
import type { ToolDef } from '@cafe/mcp-gateway'
import type { DomainVocabulary, Role, RoleModels, Scenario } from '@cafe/protocol'

/** The three agent slots the harness staffs: intake (agent 1), fulfilment (agent 2), orchestrator. */
export type AgentSlot = 'cashier' | 'barista' | 'manager'

export interface StaffSlot {
  /** Display names, cycled when more than one agent fills the slot. */
  names: string[]
  /** Sprite keys for the cafe scenes; other domains can reuse the cafe's. */
  sprites: string[]
  /** The agent's system prompt, given its name. */
  prompt: (name: string) => string
}

/**
 * A domain pack is everything that makes the harness about a particular business.
 * The harness itself (the case lifecycle, the durable work queue, the gateway's
 * scope checks, telemetry, review, judge, metrics, suites) never changes; a pack
 * supplies the words, the tools, the prompts, the scripted mocks, the golden
 * dataset and the triage/review/judge wording.
 *
 * Flow the harness runs for every case, whatever the domain:
 *   case arrives → orchestrator triage (evaluate) → agent 1 does intake with its
 *   tools and puts a work item on the queue (or declines) → agent 2 claims it and
 *   fulfils it → orchestrator review (evaluate) → blinded judge (evaluate).
 *
 * Work items live in the harness's durable queue (the `orders` table): lines with
 * a name, reference, quantity and price. A cafe line is a drink; a support line is
 * a refund. Ground truth compares those lines and the outcome to the golden case.
 */
export interface DomainPack {
  id: string
  label: string
  blurb: string
  vocabulary: DomainVocabulary
  staff: Record<AgentSlot, StaffSlot>
  /** Every tool the pack's agents may be granted. */
  tools: ToolDef[]
  /** Which scopes each role holds; the gateway enforces this, whatever the model asks for. */
  roleScopes: Partial<Record<Role, readonly string[]>>
  /** The golden dataset that ships with the pack (read-only, id `builtin:<id>` unless noted). */
  dataset: { id: string; name: string; description: string; scenarios: Scenario[] }
  /** Model specs a new run starts with: the pack's scripted mocks, free and deterministic. */
  defaultRoles: RoleModels
  /** The structured context agent 1 gets alongside the case's opening line. */
  intakeContext: (scenario: Scenario, customerId: string) => Record<string, unknown>
  /** The standing instruction agent 2 gets each time it goes to the queue. */
  fulfilTask: string
  /** The tool whose success means agent 2 handed the result over (moves it to the pickup station). */
  handoffTool: string
  triage: { state: (utterance: string) => string; questions: TriageQuestions }
  judgeQuestions: JudgeQuestions
  reviewQuestions: ReviewQuestions
  /** Per-run setup (the cafe stocks its pantry). */
  initForRun?: ((store: CafeStore, runId: string) => Promise<void>) | undefined
}
