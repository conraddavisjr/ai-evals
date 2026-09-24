# Swapping the orchestrator

The cafe does not care which engine runs a shift.
`RunConfig.orchestrator` names an entry in `apps/server/src/orchestrators/index.ts`, and everything downstream (the scene, the panels, the judge, the metrics, the telemetry, the suites) only sees the event stream.
This page is the contract for adding an engine such as Mastra or LangChain next to the built-in one.

## The contract

An engine is a factory `(deps: OrchestratorDeps) => Orchestrator` registered under an id.

```ts
interface Orchestrator {
  readonly runId: string
  run(): Promise<void>   // resolves at a terminal run status
  cancel(): void
}
```

`OrchestratorDeps` gives the engine everything it needs:

- `store`: the Postgres store (orders, inventory, usage, ...).
- `bus`: the run's `EventBus`; `bus.emit()` stamps ids and persists every event.
- `config`: the parsed `RunConfig` (roles, staffing, chaos, budget, flags).
- `scenarios`: the resolved golden items, in order.
- `registry`, `now`, `sleep`: optional injection for tests.
- `parentContext`: the OpenTelemetry parent (a suite span, when the run is part of one).

## What the engine must do

For the whole run:

1. `store.runs.setStatus(runId, 'running', { startedAt })` and `store.inventory.initForRun(runId)`.
2. Emit `run.started { config }`, then `agent.spawned` for each member of staff and `staffing.changed`.
3. For each scenario, play a visit (below).
4. Roll up: `runMetrics(runId, bus.buffer, perVisitMetrics, scenariosById)`, `store.metrics.save(...)`, emit `run.finished { summary }`, set the run status to `finished` (or `cancelled`).
5. On a run-level failure: emit `run.failed { error }`, set status `failed`, rethrow.
6. Always `await bus.flush()` at the end.

For each visit:

1. Emit `customer.arrived`, `customer.moved`, `customer.spoke` with a fresh `txId`.
2. Run the staff however the engine likes, as long as their work surfaces as events: `agent.thinking`, `agent.tool_called` / `agent.tool_returned`, `agent.spoke`, `agent.error`, `model.usage` (tokens, cost, latency per model step), and the `order.*` and `payment.*` events for what happened to the ticket.
3. Emit `customer.left { outcome }` with one of `served`, `refused`, `abandoned`, `failed`.
4. Call `closeVisit(pipelineDeps, { txId, customerId, scenario, order, outcome })` from `apps/server/src/orchestrators/visit-pipeline.ts`.
   That runs the manager review, the judge and the visit metrics exactly as the built-in engine does, so results stay comparable across engines.

## Reaching the tools

Two doors, same tools, same scope checks, same events:

- In-process: `new Gateway({ store, emit: bus.emit, chaos, now })` and `gateway.call(capability, toolName, args)`, which is what `runAgent` in `packages/agents` does.
- Over MCP: the server exposes `/mcp/:runId/:role` (streamable HTTP), so a Mastra or LangChain agent can connect as a normal MCP client with the role's tool slice.
  Tool calls made this way still emit `agent.tool_called` / `agent.tool_returned` and open `tool` spans.

## Telemetry

Open a `run` span under `deps.parentContext` and a `visit` span per customer (`@cafe/telemetry`'s `withSpan('visit', ...)`); anything the engine starts inside those (turns, steps, tools) nests automatically through the active context.
`closeVisit` opens the `review` and `judge` spans itself.

## Registering

```ts
// apps/server/src/orchestrators/index.ts
export const ORCHESTRATORS = {
  stardust: { ... },
  mastra: {
    id: 'mastra',
    label: 'Mastra',
    description: 'Staff turns driven by Mastra agents over the MCP endpoint.',
    create: (deps) => new MastraOrchestrator(deps),
  },
}
```

`GET /api/orchestrators` lists the entries for the UI, `RunConfig.orchestrator` (and a suite variant's `orchestrator`) picks one, and the CLI takes `--orchestrator <id>`.
