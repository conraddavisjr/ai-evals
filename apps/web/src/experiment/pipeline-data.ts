import type { ArchData } from '@arch/data.js'
import { roleLabel, words } from '../lib/nomenclature.js'

/** Node ids the page dispatches on; each opens a panel with that layer's controls. */
export type PipelineNodeId =
  | 'dataset'
  | 'orchestrator'
  | 'cashier'
  | 'barista'
  | 'mcp'
  | 'review'
  | 'judge'
  | 'telemetry'

const W = 236
const H = 118

/**
 * The evaluation pipeline as a left-to-right diagram, one segment per layer. The
 * summaries are placeholders: the page overwrites them with the current choice
 * (model spec, dataset name, item count) so the diagram doubles as the config's
 * at-a-glance view.
 */
export function pipelineData(): ArchData {
  return {
    world: { w: 2130, h: 430 },
    segments: [
      {
        id: 'in',
        title: 'Golden dataset',
        sub: 'inputs + expected outputs',
        nick: '',
        x: 30,
        y: 30,
        w: 300,
        h: 370,
        tone: 'rose',
      },
      {
        id: 'orch',
        title: 'Orchestration',
        sub: 'the engine that runs every case',
        nick: '',
        x: 350,
        y: 30,
        w: 300,
        h: 370,
        tone: 'moss',
      },
      {
        id: 'agents',
        title: 'Sub-agents',
        sub: 'staff, one model each',
        nick: '',
        x: 670,
        y: 30,
        w: 300,
        h: 370,
        tone: 'gold',
      },
      {
        id: 'tools',
        title: 'MCP tools',
        sub: 'scoped tool slices + chaos',
        nick: '',
        x: 990,
        y: 30,
        w: 300,
        h: 370,
        tone: 'copper',
      },
      {
        id: 'eval',
        title: 'Evaluation',
        sub: 'reasoning over what happened',
        nick: '',
        x: 1310,
        y: 30,
        w: 460,
        h: 370,
        tone: 'lavender',
      },
      {
        id: 'out',
        title: 'Telemetry',
        sub: 'spans, metrics, charts',
        nick: '',
        x: 1790,
        y: 30,
        w: 310,
        h: 370,
        tone: 'sky',
      },
    ],
    nodes: [
      {
        id: 'dataset',
        seg: 'in',
        x: 62,
        y: 150,
        w: W,
        h: H,
        title: 'Golden dataset',
        summary: 'Pick a dataset, add items.',
        details: [
          `Each item is one golden case for ${words().business}: what the ${words().requester} says (input) and what should happen (expected ${words().line}s, ${words().moneyLabel}, tools per role, refusal, rubric).`,
          'The suite loops every item once per variant.',
        ],
      },
      {
        id: 'orchestrator',
        seg: 'orch',
        x: 382,
        y: 150,
        w: W,
        h: H,
        title: 'Orchestrator',
        summary: `Engine + orchestrator model (${words().roles.manager}).`,
        details: [
          'Starts each case, hands it to agent 1, runs the agent 2 loops; optionally routes each case first.',
          'Swappable: the engine is a registry entry (Mastra, LangChain, ...).',
        ],
      },
      {
        id: 'cashier',
        seg: 'agents',
        x: 702,
        y: 70,
        w: W,
        h: H,
        title: roleLabel('cashier'),
        summary: 'Model + how many.',
        details: [words().agentBlurbs.cashier],
      },
      {
        id: 'barista',
        seg: 'agents',
        x: 702,
        y: 230,
        w: W,
        h: H,
        title: roleLabel('barista'),
        summary: 'Model + how many.',
        details: [words().agentBlurbs.barista],
      },
      {
        id: 'mcp',
        seg: 'tools',
        x: 1022,
        y: 150,
        w: W,
        h: H,
        title: 'MCP gateway',
        summary: 'Scopes, chaos, latency.',
        details: [
          'Every tool call is scope-checked, timed, chaos-injected and emitted as an event and a span.',
          'Reachable in-process or over /mcp/:runId/:role for external engines.',
        ],
      },
      {
        id: 'review',
        seg: 'eval',
        x: 1342,
        y: 70,
        w: W,
        h: H,
        title: 'Orchestrator review',
        summary: 'The orchestrator model reasons over the case.',
        details: [
          'Reads the unblinded tool trail, transcript and errors; files the case as ok, concern or escalate with typed issues.',
          `Uses the orchestrator model (the ${words().roles.manager}).`,
        ],
      },
      {
        id: 'judge',
        seg: 'eval',
        x: 1342,
        y: 230,
        w: W,
        h: H,
        title: 'LLM as judge',
        summary: 'Pick the judge model.',
        details: [
          'Sees a blinded transcript (roles only, no model names) and answers typed questions: correct, refusal appropriate, helpfulness, tone, tool use.',
        ],
      },
      {
        id: 'telemetry',
        seg: 'out',
        x: 1822,
        y: 150,
        w: W,
        h: H,
        title: 'Spans + metrics',
        summary: 'Results per item and per variant.',
        details: [
          'OpenTelemetry spans for every turn, step, tool call and evaluate() call; metrics rolled up per run and compared across variants.',
        ],
      },
    ],
    edges: [
      { from: 'dataset', to: 'orchestrator', label: 'items, in order' },
      { from: 'orchestrator', to: 'cashier', label: 'runAgent' },
      { from: 'orchestrator', to: 'barista', label: 'agent 2 loop' },
      { from: 'cashier', to: 'mcp', label: 'tool calls' },
      { from: 'barista', to: 'mcp', label: 'tool calls' },
      { from: 'mcp', to: 'review', label: 'tool trail' },
      { from: 'orchestrator', to: 'review', label: 'after each case' },
      { from: 'review', to: 'judge', label: 'then the judge' },
      { from: 'judge', to: 'telemetry', label: 'verdicts' },
      { from: 'mcp', to: 'telemetry', label: 'spans' },
    ],
  }
}
