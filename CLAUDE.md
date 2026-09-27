# Evals Cafe: working notes for agents

## Keep the architecture map current

`docs/architecture/data.js` is the single source for the interactive architecture map.
It is rendered in the app (hamburger menu, "Architecture") and in the standalone pages `docs/architecture/traditional.html` and `docs/architecture/cafe.html`.
Whenever the architecture changes, update the map in the same change:

- a new package, app, service, external provider or database: add a segment or node;
- a module that gains or loses a responsibility, or a renamed file: update the node's title, summary, details and files;
- a new call path between components (REST, SSE, tool call, DB access, model call): add or relabel an edge;
- a removed component: remove its node and edges.

Then run `python3 docs/architecture/build.py` to regenerate the standalone pages and commit them with the code.
A change that touches `apps/server`, `packages/*` boundaries, or `apps/web/src/{playback,state,scene3d}` almost always needs a map update; treat "did I update the map?" as part of done.

## Conventions

- No em dashes in prose; one sentence per line in long Markdown; no agent co-author lines in commits.
- Node 24 via `.nvmrc`, pnpm via corepack. Postgres on 5434, API on 4747, web on 5180.
- Tests need the database: `pnpm db:up`, then `pnpm test` with `.env` loaded.
- Scene work stays behind the `TimelinePlayer` contract described in `docs/HANDOFF-visual-style.md`.
