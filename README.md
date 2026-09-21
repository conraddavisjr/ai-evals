# Stardust Cafe

A model-agnostic evaluation harness for multi-agent pipelines, visualized as a Stardew-style cafe.
Every member of staff is a sub-agent with its own model and its own slice of MCP tools.
Customers are scripted scenarios (happy path, edge cases, adversarial).
The harness records ground-truth correctness, tool-use correctness, blinded LLM-judge scores, latency, failure rate, tokens, and cost, and replays any shift pixel for pixel.

## What is in the box

| Package | Purpose |
|---|---|
| `packages/protocol` | Zod schemas for the `CafeEvent` stream, orders, scenarios, run config, metrics, and the beat/waterfall derivation (`beatsOf`). The one contract every other package speaks. |
| `packages/db` | Drizzle + Postgres schema, migrations, seed catalog (menu, recipes, inventory, loyalty customers), and the `CafeStore` interface. Other databases plug in behind the same interface. |
| `packages/mcp-gateway` | The MCP tool server. Tools are grouped by scope; each role holds a capability with its slice. Out-of-scope calls are rejected and emitted as `agent.scope_violation`. Chaos injection (tool errors, latency) lives here. Also exposes each slice as a real MCP server over streamable HTTP. |
| `packages/models` | `ModelRegistry`: one string spec per role resolves to a chat model or an evaluation model. Anthropic, OpenAI, Google, Vercel AI Gateway (the route to TypeSafe Jev), any OpenAI-compatible server (Ollama), and deterministic `mock:` personas. Cost table and the live-model guard. |
| `packages/agents` | `runAgent()`: persona + sliced tools + the AI SDK tool loop + budget guard + crash injection. Emits `agent.*` and `model.usage` events. |
| `packages/evals` | Scenarios, deterministic ground truth, the blinded judge (`experimental_evaluate`, same questions for Jev or any LLM), door triage questions, metrics roll-up. |
| `apps/server` | Hono API: run manager, the shift orchestrator (cashiers, FIFO ticket rail, barista workers, judge), SSE event stream, replay, MCP endpoints, and the headless eval CLI. |
| `apps/web` | Vite + React + Three.js. A stylized top-down 3D village square (chunky beveled geometry, toon shading, warm lanterns against a dusk-teal palette) consumes events through a `TimelinePlayer` with four playback modes, plus panels for run config, visits with waterfalls, queue, inspector, metrics, and the event log. The pixel-art Phaser version lives on `main`; this look is the `style/painterly-topdown` branch. |

## Quick start

Requirements: Node 24 (`.nvmrc`), pnpm via corepack, Docker.

```sh
nvm use
corepack enable
pnpm install
cp .env.example .env         # no keys needed for mock runs
pnpm db:up                   # Postgres on localhost:5434
pnpm db:migrate && pnpm db:seed
pnpm dev                     # API on :4747, web on :5180
```

Open http://localhost:5180, keep the default `mock:*` staff, and press **Open the cafe**.
Everything runs for free on deterministic mock personas that drive the real tools, database, events, and metrics.

Tests need the database running:

```sh
pnpm test
pnpm lint
pnpm typecheck
```

## Swapping models

A role's model is a single string:

```
anthropic/claude-haiku-4-5-20251001
openai/gpt-5-mini
google/gemini-2.5-flash-lite
gateway:typesafe-ai/jev          # TypeSafe Jev via Vercel AI Gateway
gateway:anthropic/claude-opus-5
ollama/llama3.3                  # any OpenAI-compatible server
mock:cashier                     # deterministic, zero cost
```

Set them per role in the UI or in a run config file.
Every run is traced with OpenTelemetry (suite > run > visit > agent turn > step > tool call, plus triage, review and judge).
Spans land in the `spans` table as they close, so `GET /api/runs/:id/telemetry` (tool latency, reasoning latency per step, cost trajectory, errors by layer, per-visit items) works while a run is live; set `OTEL_EXPORTER_OTLP_ENDPOINT` to also export to Jaeger, Grafana or any OTLP collector.

The server and the CLI load `.env` themselves, so `pnpm dev` and `pnpm eval` see your keys without sourcing the file. Live models are refused until `CAFE_ALLOW_LIVE_MODELS=true` is set in `.env`, and every run has a hard USD cap (`budget.maxUsdPerRun`), a step cap, and a token cap per agent.

### Where Jev fits

TypeSafe's Jev is a decision model: state plus typed questions in, typed answers with calibrated probabilities out.
It cannot run a tool loop, so it cannot be a cashier or barista.
It is a natural **judge** and **door triage** (manager) model.
Both go through the AI SDK's `experimental_evaluate`, which the Anthropic, OpenAI, and Google providers also implement through structured-output adapters, and which this repo extends to any chat model (`packages/models/src/llm-evaluation-adapter.ts`).
That means the judge question set is identical whether the judge is Jev, Claude, GPT, Gemini, or an open-weights model, which is what makes judge swaps a fair comparison.

## Running evals headlessly

```sh
pnpm eval --instant                                  # all scenarios, mock staff
pnpm eval --config runs/compare-models.json          # several configs back to back
pnpm eval --suite runs/suite.example.json            # a suite: variants x repeats over one golden dataset, compared side by side
pnpm eval --dataset <id>                             # a saved golden dataset (built-in ids and ds:<dataset>:<slug> can be mixed)
pnpm eval --cashier anthropic/claude-haiku-4-5-20251001 --judge gateway:typesafe-ai/jev --max-usd 0.25
```

`runs/frontier-vs-jev.example.json` is the Claude vs GPT vs Gemini staff comparison with Jev as judge, plus a same-family judge as a control.
Every CLI run is persisted and appears under **Recent shifts** in the UI for replay.

Three ways to watch a shift, switchable in the header: **Village** (painterly 3D), **Pixel** (the original pixel cafe) and **Trace**, a terminal-style board with no characters: one column per golden item, orchestration, agent steps, tool calls (✓ against the item's expected tools) and the verdicts top to bottom, pan and zoom, click to seek.

The **Experiment** page (hamburger menu) is the workbench for comparisons: click a layer of the pipeline diagram to pick its model or edit the golden dataset, add variants (each loops the whole dataset with its own model assignment, engine, or chaos), run the suite, and read the results side by side: pass rates, refusals, tool precision, latency, judge and review verdicts, cost, an item × variant grid, and the telemetry charts per variant.

Swapping the orchestration engine (Mastra, LangChain, ...): `docs/ORCHESTRATORS.md`. Pointing the agents at a different MCP server and its database: `docs/TOOL-SOURCES.md`. Design handoff and style brief: `docs/HANDOFF-visual-style.md`. Plugging the stage into another harness: `docs/EMBEDDING.md`. Side-by-side of both styles: `docs/screenshots/style-comparison.png`. Interactive architecture maps: `docs/architecture/traditional.html` and `docs/architecture/cafe.html`.

## The 3D scene

`apps/web/src/scene3d/` builds the square procedurally: `builders.ts` makes every prop from rounded boxes, cylinders and spheres (no external assets), `materials.ts` gives them a four-band toon gradient, `CafeWorld.ts` places them on the same 20 x 13 tile grid the layout has always used, and `mergeStatic()` bakes the static props into one mesh per material so a frame is a couple of dozen draw calls.
Characters are chunky low-poly figures whose limbs swing while they walk; names, bubbles, progress rings and the red `!` are HTML projected over the canvas (`Overlay.ts`), so they share the app's typography.
Lighting is a cool hemisphere plus a soft shadow-casting key light, warm point lights on the lamps, brazier and pastry case with per-lamp flicker, ACES tone mapping and a bloom pass that only catches emissives.

The scene starts at a shallower 40-degree viewing angle.
Drag to orbit, scroll or pinch to zoom, and right-drag or Shift-drag to pan.
On a Mac trackpad, secondary-click with two fingers and drag to pan.
On a touch screen, drag with one finger to orbit, or use two fingers to pinch and pan.
Click or tap a character to inspect it, and use **Reset view** in the scene to return to the default framing.
Camera gestures do not change the playback clock, and resizing preserves a view you have adjusted.

## Time and playback

Real timing is bimodal: model steps take seconds, tool calls take milliseconds.
The scene is therefore never driven by the wall clock; it is driven by a `TimelinePlayer` over the event stream.

- **Live** renders a few seconds behind real time so every beat can be animated properly.
- **Raw** is wall clock with no buffer.
- **Replay** plays a stored run at a chosen speed.
- **Step** pauses on every beat and shows the real delta since the previous one.
- **Director's cut** stretches sub-perceptual gaps and compresses hangs, per character, so order is preserved and everything is visible.

Progress rings over working staff fill against that role's typical duration and turn amber, then red, on overshoot.
Each visit has a waterfall (arrive, cashier, queue wait, barista, pickup, judge) with percentages, so a hung step is obvious at a glance.

## Failure modes you can simulate

Run config `chaos`: `toolErrorRate`, `toolLatencyMs`, `agentCrashRate`, `crashRoles` (for example baristas only), and a `seed` so chaos is replayable.
Mock pacing can make a barista hang on a given order (`mockPacing.hangOrders`).
A crashed barista's ticket goes back to the front of the rail (up to three attempts); a red `!` appears over the agent and clicking it opens the failure in the Inspector.

## Metrics

Per visit and per run: task success against ground truth, refusal accuracy, tool precision and recall (role aware), scope violations, retries, errors, end-to-end and per-beat latency percentiles, model latency per role, steps per visit, tokens, USD, and the judge's blinded scores (correct, refusal appropriate, helpfulness, tone, tool use).
The Metrics tab compares recent shifts side by side.

## Talking to the cafe from another MCP client

Each role's slice is a real MCP server:

```
POST http://localhost:4747/mcp/<runId>/barista
```

Point an MCP client at it and it sees exactly the barista's tools, nothing else.
