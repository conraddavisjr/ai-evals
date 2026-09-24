# Embedding the cafe in another harness

The stage (scene, playback controls and panels) is built to be lifted out of this repo and pointed at a different evaluation harness.
This page lists the seams that make that possible and what each side has to provide.
It is deliberately short; the code comments on the two interfaces carry the detail.

## The three seams

1. **The event protocol** (`packages/protocol`).
   Everything on screen is a fold of `CafeEvent`s (`packages/protocol/src/events.ts`).
   A harness that emits these events, with monotonically increasing `seq` and epoch-ms `t`, can drive the whole stage.
   Nothing in `apps/web` reads any other server data during playback.

2. **The harness client** (`apps/web/src/harness/types.ts`).
   `HarnessClient` is the only thing the UI calls for data: models, scenarios, runs, a run's events, metrics, judgements, start, cancel, and `stream()` to tail a live run.
   `createHttpHarness(baseUrl)` is the Stardust server implementation over REST + SSE.
   The client is handed to the tree once, in `apps/web/src/main.tsx`, through `HarnessProvider`; panels get it with `useHarness()`.
   To embed elsewhere, implement `HarnessClient` against your backend and swap that one line.
   Anything you cannot answer (metrics, judgements) can reject; the panels that use them show the error and the rest keeps working.

3. **The scene view** (`apps/web/src/views/types.ts`).
   A `SceneView` is `{ id, label, blurb, mount(parent, player, callbacks) }`; `mount` resolves to `{ step(now), destroy() }` and is async so each renderer is downloaded only when it is first shown.
   Every view is a pure consumer of the `TimelinePlayer`: it subscribes to `onApply` and `onSnap`, ticks the player once per frame, and reads `player.state` and `player.clockEpoch()` for anything time based.
   Two views are registered in `apps/web/src/views/index.ts` (the painterly village and the pixel cafe) and the header switches between them at any time, including mid-run, because the new view snaps to `player.state` on mount.
   To add a view, add an entry to `SCENE_VIEWS`; nothing else changes.
   The Trace view (`apps/web/src/scene-trace/`) is the smallest example: plain DOM, no renderer, a pure `buildTrace(events)` model under it.
   Because views only see events, `customer.arrived` carries the golden item's `expected` block (outcome, tools per role, tags), which is what lets a view mark each step right or wrong without asking the harness.

## What stays put

`apps/web/src/playback/TimelinePlayer.ts` and `apps/web/src/state/cafe-state.ts` are the shared core and must travel with the stage unchanged; they are what make live, replay, step and the director's cut show the same thing.
The playback help text (`apps/web/src/playback/mode-docs.ts`) lives next to the player for the same reason: the stage documents itself wherever it lands.

## The experiment client

`ExperimentClient` (same file) is the optional second seam: telemetry, golden datasets, orchestrator listing and suites.
`useExperimentApi()` returns null when the provided client does not implement it, and the Experiment page and Telemetry view say so instead of breaking; a harness that only emits events still gets the stage.

## Ways to start a shift today

- The **Open the cafe** button (header, the empty stage, or the top of the Shift tab) POSTs the drafted config through the harness client.
- **Recent shifts** in the Shift tab loads any persisted run; a finished one replays, a running one attaches live.
- The headless CLI, `pnpm eval --config runs/compare-models.json` (see `apps/server/src/cli.ts`), runs shifts without the UI and persists them, so they show up under Recent shifts afterwards.
- Any client can `POST /api/runs` directly with a `RunConfigInput` and then tail `GET /api/runs/:id/stream`.
