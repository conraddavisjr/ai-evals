# Architecture diagrams

Two interactive maps of the same architecture, built from one data model.

- `traditional.html`: engineering-diagram treatment (light and dark).
- `cafe.html`: the cafe treatment, segments named as districts of the square, in the dusk palette of the 3D scene.

Open either file directly in a browser. Drag to pan, scroll or pinch to zoom, click a component to expand its details and highlight its connections, Esc to collapse, `0` to fit, `+`/`-` to zoom, or type a component name in the search box.

Sources: `data.js` (segments, nodes, edges, details, file paths), `engine.js` (canvas, pan/zoom, expansion), `base.css` (structure), `theme-*.css` (looks), `template.html`.
Rebuild both pages after editing any of them with `python3 docs/architecture/build.py`.
The `dist/` copies omit the document skeleton for hosts that wrap pages themselves.

## Keep it current

This map is part of the product (hamburger menu → Architecture in the app) and part of the docs.
When the architecture changes, change `data.js` in the same commit: add or remove nodes and edges, fix titles, summaries, details and file paths, then run `python3 docs/architecture/build.py`.
The root `CLAUDE.md` repeats this rule for agents working in the repo.
