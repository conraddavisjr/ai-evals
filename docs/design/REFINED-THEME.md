# Refined theme

The refined theme is the default look of the Stardust web app.
It is one override stylesheet, `apps/web/src/themes/refined.css`, scoped under `:root[data-theme="refined"]`.
The base stylesheets stay the Stardust (game) theme, byte for byte, and `data-theme="stardust"` shows them untouched.
The Village and Pixel canvases keep their game look in both themes: everything inside `.scene-host` (except the Trace board) gets the Stardust tokens back.

## Principles

1. Content first, chrome second.
   Surfaces are flat and quiet so the data (cases, badges, verdicts, numbers) carries the colour.
2. One type family, three weights.
   Inter at 400 for reading, 500 for labels and controls, 600 for titles and key numbers.
   Nothing heavier, no display face, no text shadows.
3. Sentence case everywhere.
   No uppercase labels, no letter-spaced small caps.
   The one exception is an acronym such as MCP.
4. Colour means something.
   Layer colours identify the pipeline layer, green means the case did what was expected, red means it deviated, amber means caution.
   Everything else is neutral grey.
5. A 4px grid, with 8, 12 and 16 doing most of the work.
6. Hierarchy through size, weight and grey level before borders, and borders before shadows.
7. Every control has a visible hover and a 2px focus ring.
8. Everything must read at a 360px side panel.

## What we took from each system

### Apple (Human Interface Guidelines, macOS)

- Dense desktop UI works at small sizes: macOS body text is 13pt, with 11 and 10pt for secondary text.
  We use 13px as the UI body and never go below 10.5px, and only for mono metadata.
- Segmented controls are a recessed track with a raised, lighter selected segment.
- Hierarchy comes from weight and grey level (label, secondary label, tertiary label), not from colour.

### Stripe (Dashboard and docs)

- Status badges are small, sentence case, tinted fills with coloured text and no outline.
- Tables are simple: hairline row dividers, muted medium-weight headers, tabular figures, generous 6-8px cell padding.
- Data areas are dense while the chrome around them is generous.
- A single saturated accent (indigo) for primary actions and links.

### Airbnb (Design Language System)

- A strict spacing ramp on a 4px base: 4, 8, 12, 16, then big jumps for sections.
- Soft, consistent corners: about 8px for controls, 12px or more for cards and sheets.
- One typeface, one accent.

### Google (Material 3)

- A named type scale with fixed line heights (for example Label small is 11/16, Body medium is 14/20).
  We mirror the idea with our own steps below.
- Line height around 1.5x for body and label sizes.
- Tonal surfaces: in dark themes, higher containers are lighter, not shadowed.
  We use five surface tones from canvas to selected.
- Underline tabs with a 2px indicator for primary navigation inside a pane.

### Slack

- Readability over density for anything people read in volume.
  Messages sit at about 15px with a 1.46 line height; our prose blocks (quotes, explanations) get 12.5-13px at 19-20px.
- Dark mode is neutral grey, not tinted, so coloured content pops.

### Figma (UI3)

- Inter at 11px for property panels, with two weights doing all the hierarchy (450 and 550).
- Hierarchy through clear blocks and spacing instead of heavy headings, which avoids reading fatigue.
- Inputs get a subtle filled background and a 1px border; panels float on a canvas.

## Fonts

- UI: **Inter** (Google Fonts, variable, `opsz` 14-32, weights 400-700).
  Character variants `cv05` (lowercase l with tail) and `cv08` (upper-case I with serifs) are on, so ids like `Il1` are unambiguous.
- Mono: **JetBrains Mono** 400, 500, 600 (already loaded by the base theme).
- Geist and Geist Mono are also on Google Fonts now and are a good alternative pair if we ever want a slightly more geometric look.
- Numbers in tables, pills, tiles, the readout and charts use `font-variant-numeric: tabular-nums`.

## Tokens

### Surfaces and text (dark)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0e1013` | App canvas, page background |
| `--bg-2` | `#111317` | Inset: inputs, code, tracks |
| `--panel` | `#16181d` | Surfaces: header, side panel, tiles on the Trace board |
| `--panel-2` | `#1c1f25` | Raised: cards, sections, menus |
| `--panel-3` | `#242831` | Selected: chosen segment, tooltips |
| `--line` | `#262a32` | Hairline dividers |
| `--line-2` | `#323743` | Control borders, table header rule |
| `--rf-line-3` | `#454b58` | Hover border |
| `--text` | `#e7e9ed` | Primary text |
| `--rf-text-2` | `#c4c9d2` | Secondary text, prose |
| `--muted` | `#959cab` | Labels, captions (about 6.5:1 on `--panel`) |
| `--rf-text-3` | `#6d7482` | Disabled, faint metadata |

### Accent and status

| Token | Value | Use |
| --- | --- | --- |
| `--rf-accent` | `#6d8cff` | Tab indicator, focus, scrubber, selection |
| `--rf-accent-strong` | `#4f6ef0` | Primary button fill (white text) |
| `--rf-accent-text` | `#9db1ff` | Links, accent text; also mapped to the base `--gold` |
| `--good` / `--rf-good-text` | `#3fcf8e` / `#74e0ad` | Passed expectation |
| `--bad` / `--rf-bad-text` | `#f2555a` / `#ff9a9d` | Deviated, error |
| `--rf-amber` / `--rf-amber-text` | `#e5a54b` / `#f2c47e` | Caution, refused, concern |
| `--rf-info-text` | `#93c9ee` | Running, open, pending |
| `--rf-violet-text` | `#c6b3ff` | Interrupted, evaluation accents |

Status fills are the status colour at 13-16% alpha behind the `*-text` colour.
A deviated verdict gets a slightly stronger fill and a 1px inner ring so it is findable at a glance.

### Layer colours (Trace board)

The meaning is unchanged from Stardust; the hues are slightly calmer.

| Layer | Token | Value |
| --- | --- | --- |
| Case input | `--tr-input` | `#f27aa0` |
| Orchestration | `--tr-orch` | `#5cc98f` |
| Sub-agent | `--tr-agent` | `#f0c350` |
| MCP tool | `--tr-tool` | `#f59a5c` |
| Evaluation | `--tr-eval` | `#a98bff` |
| Error | `--tr-error` | `#f2555a` |

### Type scale

| Step | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Page title | 15 / 22 | 600, -0.01em | Page headers (Experiment, Decision bench, Architecture), brand |
| Section title | 14-15 / 20-22 | 600 | `h3` in panels and pages |
| Subsection | 13 / 20 | 600 | `h4` |
| Body | 13 / 20 | 400 | Default UI text |
| Body small | 12.5 / 19 | 400-500 | Tabs, prose blocks, help text |
| Caption | 12 / 16-18 | 400-500 | `.small`, labels, legends, table headers |
| Label | 11-11.5 / 16-20 | 500 | Pills, tags, band titles |
| Mono meta | 10.5-11.5 / 18 | 400-500 | Ids, timings, tool names |
| Key number | 20 / 28 | 600, -0.02em | Metric tiles |

### Spacing

A 4px grid: `4, 8, 12, 16, 20, 24, 32`.
Panels pad 16px; cards pad 12-16px; related controls sit 8px apart; sections sit 12-24px apart.
Badge rows keep 2px between rows and 8px between their columns.

### Radii

| Token | Value | Use |
| --- | --- | --- |
| `--rf-r-xs` | 4px | Trace badges, tags, inline code, log rows |
| `--rf-r-sm` | 6px | Buttons, inputs, segments, chips |
| `--rf-r-md` | 8px | Segmented track, tooltips, pre blocks |
| `--radius` | 10px | Cards, tiles, Trace columns, sections |
| `--rf-r-lg` | 12px | Stage frame, playback bar, menus, empty-state card |
| (pill) | 999px | Status pills |

### Elevation

Dark surfaces separate by tone first.
Shadows are reserved for things that float.

| Token | Value | Use |
| --- | --- | --- |
| `--rf-elev-1` | `0 1px 2px rgba(0,0,0,.35)` | Buttons, the chosen segment |
| `--rf-elev-2` | `0 4px 12px rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.3)` | Pinned peek pane |
| `--rf-elev-3` | `0 12px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.3)` | Menus, tooltips, the empty-state card |

### Light variant (not built yet)

If a light theme is added it should keep the same structure with these values.
Canvas `#f7f8fa`, surface `#ffffff`, raised `#f2f3f5`, line `#e4e6ea`, line-2 `#d3d6dc`, text `#16181d`, muted `#5d6472`, accent `#4f6ef0`, accent text `#3b5bdb`, good text `#0f8a55`, bad text `#c9343a`, amber text `#9a6412`.
Status fills stay at about 10-12% alpha.

## Components

### Buttons

- 28px tall, 6px radius, 12px side padding, weight 500, 1px `--line-2` border on `--panel-2`.
- Hover lightens the border; press removes the shadow; no transforms, no brightness filters.
- Primary: `--rf-accent-strong` fill, white text, weight 600.
  The big "Start run" button is 14px at 8/16px padding.
- Link buttons: accent text, no underline until hover.

### Segmented controls

- Recessed track (`--bg-2`, 1px `--line`, 8px radius, 2px padding).
- Segments are 24px tall, muted text; the chosen one is a raised `--panel-3` chip with `--rf-elev-1`.
- In the Trace toolbar the joined-button version keeps its shape; the chosen button gets `--panel-3` and a brighter border.

### Tabs

- Underline tabs: 40px tall, 12.5px medium, muted until chosen.
- The chosen tab turns `--text`, weight 600, with a 2px `--rf-accent` indicator.
- No filled tab backgrounds.

### Pills and verdict pills

- 20px tall, 8px side padding, 11px weight 500, no border, no forced capitals.
- Tinted fill plus coloured text, per the status table above.
- Labels show as authored; the source strings should be sentence case (see follow-ups).

### Scenario tags

- 18px tall, 4px radius, 11px weight 500, capitalised single word ("Happy 5/5").
- Happy is green, adversarial orange, edge violet, stress blue, all as tinted fills.

### Trace board

- Toolbar on `--panel` with 24px controls; the title is sentence case 13px semibold.
- Legend: 8px round dots in the layer colour with neutral text.
- Columns and tiles: 10px radius, `--panel` body, `--panel-2` head, 1px `--line` border.
- A deviated case keeps the red delineation: a red border at 60% and a red-tinted head.
- Band titles are 11.5px medium muted sentence case, separated by a solid hairline, sticky while a tile scrolls.
- Badges: 24px tall, 4px radius, 2px left rule in the layer colour, mono head in the layer colour at weight 500, secondary text for the description, faint mono timing.
- The current badge has a 1.5px accent outline and an accent tint.
- The MCP marker is a quiet orange-tinted tag, not a solid orange block.

### Tables

- 12.5px body, 12px medium muted headers with a `--line-2` rule, `--line` row dividers.
- 6px by 8px cells, tabular figures.
- The current row gets an accent tint.

### Metric tiles

- `--panel-2`, 1px `--line`, 10px radius, 10/12px padding.
- The value is 20/28 semibold; the label is 12px medium muted, sentence case.
- Good tiles colour the value green; bad tiles colour it red and add a faint red border and fill.
  No stripes, which fought the rounded corners.

### Inspector, peek pane and the column trail

- Definition lists use a 104px label column, 6px row gap, muted regular labels.
- Quotes are a faint neutral block with a 2px left rule, upright (not italic).
- Explanations use the accent rule; judge evidence uses the evaluation violet rule.
- Trail panes share the side panel's surface and hairlines; older panes are no longer dimmed, their headers carry the context.
- Tool chips: 24px, 6px radius, `--panel-2` with a `--line-2` border; called tools get a green border, unexpected ones amber, missing ones dashed.

### Toolbar and header

- 56px app bar on `--panel` with a hairline, no gradient, no glow.
- Brand: 15px semibold name over a 12px muted subtitle, no capitals.
- Hamburger: 32px ghost button with 1.5px strokes.

### Menu

- `--panel-2`, 12px radius, 4px padding, `--rf-elev-3`.
- 32px items at 13px medium; hover is a 5% white tint; the current page is an accent tint with accent text.

### Playback bar

- A `--panel` card with a hairline border and 12px radius.
- Scrubber: 8px track on `--line`, solid accent fill, 1px white markers (amber for refused, red for failed).
- The readout uses tabular figures; the delta is accent semibold.

### Charts

- Solid hairline gridlines, mono tick labels, medium row labels.
- Tooltips are `--panel-3` cards with `--rf-elev-3`.
- Series colours still come from the chart code.

## Follow-ups for the base styles

These are things an override layer cannot fix cleanly.

- `styles.css` styles every `<header>` element as the app bar (two bare `header { ... }` rules: min-height 74px, gradient, 3px border).
  That leaks into `.tx-head`, `.trail-head`, `.drawer-head` and `.bench-head`, including in the Stardust theme.
  Scope those rules to `.app > header`.
  The refined theme resets it with a zero-specificity rule for now.
- `architecture.css` declares `--bg: var(--bg)` and `--font-mono: var(--font-mono)` on `.archv-app`.
  A custom property that references itself is invalid, so both resolve to nothing.
  The refined theme sets concrete values; the base should rename the outer tokens.
- Status labels are lowercase in code ("in progress", "review: ok", "agrees with ground truth").
  Sentence case at the source ("In progress", "Review: OK") would read better in both themes; CSS cannot sentence-case a phrase.
- `--gold` is used both as the accent and as the caution colour (`.marker.refused`, `.queue li.warm`, `.ov-ring[data-level="amber"]`).
  A separate `--warn` token in the base would let a theme change the accent without touching caution.
- Hard-coded colours in the base that a theme has to chase one by one: `.pill.*` fills, `.tag.*`, `.inspector blockquote`, `.log-peek`, `.drawer`, `.inspector-trail`, `.chart-tip`, `.judge-answers .answer-tip`, `.tx-list .tx table.timing td` border, `.trace-tile-body .band-title` background, `.trace-col-head` background.
  Moving them onto tokens would shrink this file a lot.
- Series colours (`BEAT_COLORS`, `CATEGORICAL`, `colorOf`) live in TypeScript, so charts and waterfalls cannot be re-tuned per theme.
