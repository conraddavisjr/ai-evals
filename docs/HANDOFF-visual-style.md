# Visual style handoff: Stardust Cafe

This document is for whichever agent or person takes the next swing at how Stardust Cafe *looks*.
It says what the product is, what the scene layer must keep doing, where the style should go, what exists today, and what is weak.
Read this before touching `apps/web`.

## What the product is

Stardust Cafe is an evaluation harness for multi-agent AI pipelines, visualized as a cafe.
Each member of staff (two cashiers, one or more baristas, a manager, a judge) is a sub-agent with its own model and its own slice of MCP tools.
Customers are scripted scenarios: happy path, edge cases, adversarial.
Everything that happens is an event in a typed stream (`packages/protocol/src/events.ts`); the scene is a pure consumer of that stream, which is what makes live view, replay, step-through and the "director's cut" all show the same thing.
The visual job of the scene is not decoration: it must make the pipeline legible.
A viewer should be able to tell at a glance who is working, what tool they are calling, how long they have been at it, which tickets are waiting, and where something went wrong.

Two styles exist:

- `main`: Stardew-style pixel art in Phaser 3 (`apps/web/src/scene/`).
- `style/painterly-topdown`: stylized top-down 3D in Three.js (`apps/web/src/scene3d/`). This is the direction to push further.

Side by side: `docs/screenshots/style-comparison.png`.

## Style DNA (the brief, verbatim from Conrad)

> Act as an expert Game Art Director and Technical Artist specializing in modern stylized 3D game engines (Unreal Engine 5 / Unity).
> We are collaborating on replicating a specific visual style based on the "Top-Down Starter Kit by PolyNext."
>
> 1. CAMERA PERSPECTIVE: fixed, angled top-down (isometric/axonometric projection). Camera must emphasize verticality (deep canyons, tall waterfalls) while keeping a clear, readable playing field on horizontal pathways.
> 2. TEXTURE & MATERIAL ART STYLE: "hand-painted" or "stylized painterly" (World of Warcraft, Torchlight, modern Zelda). Low micro-surface noise. Materials rely on clean color gradients, baked ambient occlusion, and hand-painted edge highlights rather than noisy PBR photo-textures.
> 3. MESH GEOMETRY & PROPORTIONS: chunky and heavily beveled. No razor-sharp, mathematically perfect edges. Stone tiles, boulders and pillars have thick, softened, slightly exaggerated proportions with tactile, stylized weight.
> 4. LIGHTING & COLOR PALETTE: saturated, high-contrast, atmospheric. Heavy use of localized warm emission (orange-yellow torch flames, braziers) against contrasting cool environmental tones (deep teal or rich blue water, mossy green banks).

Reference images (PolyNext Top-Down Starter Kit): `docs/reference/polynext-bridge.png`, `docs/reference/polynext-village.png`, `docs/reference/polynext-search-results.png`.
Conrad chose the **village-square kiosk** composition (like the village reference): cobblestone plaza, market-stall counter under an awning, cottage facades, warm lamps, a small teal fountain for the cool contrast.
He explicitly does not want the brown/amber/yellow "Claude" palette; keep the dusk teal and lantern gold, with torch orange reserved for emphasis.

Current UI tokens live at the top of `apps/web/src/styles.css`; fonts are Lilita One (display), Nunito (body), JetBrains Mono (code), loaded in `apps/web/index.html`.

## The contract the scene must keep

Do not change anything under `packages/` or `apps/server/`, and do not change `apps/web/src/playback/`, `apps/web/src/state/`, or the React panels' behaviour. Style them freely.

The scene is created by `createGame(parent, player, callbacks)` in `apps/web/src/scene3d/game.ts` and must return `{ scene, renderer, camera, step(now), destroy(), frameMs }`.
`App.tsx` mounts it once and exposes `window.__cafe = { player, game }` in dev.

The scene subscribes to the `TimelinePlayer` (`apps/web/src/playback/TimelinePlayer.ts`):

- `onApply(event, state)`: animate exactly this one event.
- `onSnap(state)`: the user seeked; rebuild the whole picture from `state` with no animation.
- Every frame call `player.tick(now)` first, then read `player.state` and `player.clockEpoch()` for anything time-based (rings, ticket ageing). Never use the wall clock for simulation time.

Events that must have a visible response (see `CafeScene3D.ts` `apply()` for the current mapping):

| Event | What the viewer should see |
|---|---|
| `agent.spawned` / `agent.moved` | staff appear at their station; walks along the row-3 lane |
| `customer.arrived` / `customer.moved` / `customer.left` | customers enter through the gate, walk the row-10 aisle to registers, waiting slots, pickup, and out |
| `agent.thinking`, `agent.tool_called`, `agent.tool_returned` (ok=false) | thinking dots; a tool bubble naming the tool; a failure shout |
| `agent.spoke`, `customer.spoke` | speech bubbles |
| `agent.error` | a persistent, clickable red `!` (click selects the agent and opens the Inspector) |
| `agent.scope_violation` | a "not my job" shout |
| `order.queued` / `order.requeued` / `order.claimed` / `order.failed` | a ticket appears on the rail, ages from cream to amber to red, bounces at the front when a barista is free, flies to the barista on claim, drops in red on failure |
| `order.ready`, `order.called_out`, `order.delivered` | barista at the pickup counter calls the customer's name |
| `triage.decided`, `judge.verdict` | manager thought bubble; judge verdict bubble |
| `run.started`, `run.finished` | banner |

Also required: a progress ring over each working agent, filled against that role's typical duration (`workDurations` median, fallback constants), amber past 100 percent and red past 200 percent, with the elapsed seconds as a label; steam over a machine while its barista is busy; clicking a character selects it; playback speed scales walk and bubble timing (`speed()` / `ttl()` in `CafeScene3D.ts`); in step mode bubbles linger.

Positions come from the tile grid in `apps/web/src/scene3d/layout.ts` (20 x 13 tiles, 1 tile = 1 m, tile (x, y) at world (x + 0.5, 0, y + 0.5)).
Stations, waiting slots, pickup slots and the aisle routing are defined there and are used by both styles; keep them or update them consistently.

Labels, bubbles, rings and alerts are HTML in `Overlay.ts`, projected from world anchors every frame.
That is deliberate: crisp text, shared typography with the panels, easy CSS.
Keep that approach unless you have a strong reason.

## What exists on the branch

- `builders.ts`: every prop is procedural (rounded boxes, cylinders, spheres, torus), no external assets. `mergeStatic()` bakes static props into one mesh per material after the world is built. Keep that call, or frame time will go from ~8 ms back to ~40 ms.
- `materials.ts`: `mat(color)` is a cached `MeshToonMaterial` with a four-band gradient map; `glow(color, intensity)` is an unlit emitter that bloom picks up.
- `CafeWorld.ts`: the composition. Kiosk on rows 2 to 4 (back bar with two espresso machines, two brass tills on the front counter, pickup counter with the ticket rail and an "ORDER UP" sign), office annex at cols 15 to 18, plaza with fountain, tables, planters, lamp posts, brazier, gate, cottages behind.
- `Character.ts`: chunky low-poly villagers, limbs swing while walking, aprons for staff, clipboard-grey coat for the judge, a gold floor ring when selected.
- `effects.ts`: water shader for the fountain, steam particles, lantern/brazier flicker.
- `game.ts`: perspective camera at 55 degrees pitch and 9 degrees yaw, auto-fit and centred on the grid; hemisphere + shadow-casting key + warm fill + a soft light over the working lane; ACES tone mapping; bloom at quarter resolution.

## What is weak (an honest list)

1. **Materials are flat colour.** There are no painted edge highlights, no gradient per face, no baked AO beyond the cobbles. The style calls for hand-painted gradients and light edges on every bevel. A gradient in the vertex colours (lighter tops, darker bases) and a thin light rim on top edges would move it a long way.
2. **Silhouettes are too small at this camera distance.** Registers versus espresso machines are distinguishable but not from across the room. Exaggerate proportions further; consider a hanging "PAY HERE" sign over the tills and a copper hood over the machines.
3. **No verticality.** The references have canyon walls and waterfalls. The plaza is flat. A raised terrace step, a taller back wall with a balcony, a stream along the west wall with a small fall, would add depth without moving any station.
4. **Cottages are crude.** Roofs are two slabs; walls are plain plaster with three beams. They need dormers, chimneys with smoke, timber patterns, shutters.
5. **Awning constraint.** At this pitch a canopy at 2.6 m hides ~2 m of floor behind its front edge, which is why the awning only covers the back bar. Any canopy over the working lane needs to be higher, thinner, or see-through.
6. **Characters have no face beyond two dots.** Hair shapes, hats per role (a barista cap exists), and a slight lean while carrying a tray would give personality.
7. **The ticket rail is faint.** Tickets are plain cards; a wire with clips, and a glow when a ticket is overdue, would make the queue read at a glance.
8. **UI chrome is competent, not distinctive.** Panels could carry the world's materials: stone-card headers, parchment for transcripts, small illustrated icons for roles and beats.

## Working rules and gotchas

- Run: `pnpm install`, `pnpm db:up`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev` (API on 4747, web on 5180). Node 24 via `.nvmrc`; pnpm via corepack.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (needs the database); then a mock shift from the Shift tab. Check live, replay, step, director's cut, click a character, click a red `!` (set `agentCrashRate` in the Chaos section to get one).
- Budget: keep a frame under ~8 ms on a laptop GPU; every real `PointLight` costs in every toon shader, so prefer emissive sprites for glow and keep real lights to about eight; keep bloom at quarter resolution.
- Hidden tabs pause `requestAnimationFrame`. In dev, `window.__cafe.game.step(performance.now())` renders one frame on demand.
- Rollback: `git checkout main` is the pixel version; do the 3D work on `style/painterly-topdown` or a branch from it.
- Conrad's conventions: no em dashes in prose, one sentence per line in long Markdown, no agent co-author lines in commits.
