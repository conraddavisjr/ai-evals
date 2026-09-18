# Painterly village square

Visual refinement of `style/painterly-topdown`, starting at `ea4f9fe`.

The scene uses cool teal slate, moss plaster, lavender canvas, jade tills and copper boilers, with localized lantern gold.
Local vertex colors paint cool shadows into the bases of props and pale highlights onto their upper bevels.
Static batching preserves those colors, and the toon ramp blends broad values rather than producing hard lighting bands.

The west stream and small fall sit below the raised plaza foundation, outside all character routes.
The north terrace, balcony, shingled roofs, shuttered windows and dormers give the square height.
Villagers have swept hair, ears, noses, cap brims, apron pockets and role-specific glasses.

The ticket rail has thicker supports, clips, a framed sign and spaced rows of tickets.
Ticket labels retain simulation-driven age colors and add a glow when overdue.
Staff names remain visible, and selected staff retain their gold ring.
The panels use stone-like headers and a pale ledger treatment for Inspector speech.

The camera fits the expanded perimeter and resets its target on resize.
Water and lamp animation use relative simulation seconds from `clockEpoch()` to preserve shader precision and repeatability when seeking.
`onApply`, `onSnap`, the station grid, routes, progress rings, steam, speech, alerts and picking remain in place.
No files under `packages/`, `apps/server/`, `apps/web/src/playback/` or `apps/web/src/state/` were changed.

## Screenshots

- [Pass 1: materials and silhouettes](screenshots/painterly-pass-1.png)
- [Pass 2: landscape and chrome during a live shift](screenshots/painterly-pass-2.png)
- [Pass 3: foliage, water and Inspector ledger](screenshots/painterly-pass-3.png)
- [Final: clearer tickets and eight point lights](screenshots/painterly-final.png)
- [Failure selection](screenshots/painterly-failure.png)

## Browser verification

An isolated Chromium browser used the existing local web and API servers with mock models only.
A four-customer shift verified live staff, progress rings and tool bubbles.
Seeking rebuilt two queued tickets, four agents and nine character roots including customers and the judge.
The Next button advanced the cursor from 76 to 82.
Clicking Juniper's character opened her Inspector.
Replay and director's cut advanced their respective clocks.
A separate three-customer mock shift with barista crash injection produced a clickable red alert that opened Hazel's simulated-crash details.
Seeking back to the error restored the alert.
The browser reported no page errors.

At 1600 by 1050 with Metal rendering, a 90-frame sample measured 1.9 ms median and 3.7 ms p95 CPU submission time, with a 16.7 ms median animation-frame interval.
These are CPU measurements from `game.frameMs`, not isolated GPU timings.
The scene contains eight real point lights and retains `mergeStatic()` and quarter-resolution bloom.

## Automated checks

- `pnpm typecheck`: passed across the workspace.
- `pnpm lint`: passed.
- `pnpm test`: 37 passed, 1 failed, 22 skipped across 9 files.
- The agents, database and gateway suites exceeded their 10-second setup hooks, followed by cleanup errors because setup had not completed.
- The server refusal close-out test took 40.8 seconds against its 15-second assertion.
- A single-worker retry with a longer CLI hook timeout still reproduced the project-level 10-second setup timeout.
- The failing tests and all backend implementation files remain unchanged.
- `pnpm test --project web`: all 8 playback and layout tests passed.
