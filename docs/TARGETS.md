# Evaluating another project's AI over HTTP

`packages/targets` runs a project's golden datasets against its eval route and gates CI on the result.
The project keeps its evaluation in its own repo, in one config pack; the harness never imports its code.
The design and the reasoning behind it are in [EXTERNAL-TARGETS.md](EXTERNAL-TARGETS.md).

## Run it

```sh
# the app under test, running locally with its eval route switched on
EVAL_SECRET=... pnpm eval:target --config ../recipe-builder/evals/stardust.config.json --smoke
```

| Flag | What it does |
| --- | --- |
| `--config <file>` | The config pack (required). |
| `--cases a,b` / `--tags x,y` / `--smoke` | Run a subset: by id, by any of the tags, or the cases marked `smoke`. |
| `--repeats n` | Run every case n times; flaky cases are named in the report. |
| `--concurrency n` | Cases in flight at once (the pack's `target.concurrency` by default). |
| `--judge <spec>` / `--no-judge` | Swap or skip the judge model (any ModelSpec, including `gateway:typesafe-ai/jev`). |
| `--max-usd n` | Stop starting cases once the target reports this much spend. A run cut short never passes. |
| `--min-pass 0.9` / `--min-pass-tag adversarial=1,benign=0.9` | Override the pack's thresholds. |
| `--json f` / `--junit f` / `--summary f` | Write the full report, JUnit XML, or a Markdown summary. |
| `--list` / `--dry-run` | Print the cases, or the exact request bodies, without calling anything. |
| `--replay <report.json>` | Re-score the answers saved by an earlier `--json` run with the current assertions and judge, without calling the app. |

Exit codes: `0` every gate passed, `1` a gate failed or the run was cut short, `2` a bad config, flag or missing environment variable.
When `$GITHUB_STEP_SUMMARY` is set the Markdown summary is appended to it.
Before any case is sent, the judge is asked one tiny question; if it cannot answer (a missing key, an unscoped account) the run stops with exit 2 instead of spending the app's money first.

## How a case is scored

1. The body template is filled from the case (`{{input.prompt}}`, `{{case.id}}`, `{{run.id}}`) and posted to the target.
2. The response is mapped through `responseMap` to one of three outcomes (served, refused, failed) with a machine `reason`.
   Transport problems become `failed` with a harness reason (`timeout`, `unreachable`, `http_500`, `unmapped_outcome`), never a crash.
3. Deterministic checks run first: the expected outcome and reason, the response against the pack's JSON Schema contract, then the case's assertions.
4. Only when all of those pass is the judge asked, with the request, the answer and the checks it can rely on, and never the model's name.
   Its answers are checked against the case's `judge` expectations over the pack's `judge.defaults`.
5. A case passes when every check passes.
   Pass rates roll up overall and per tag, and the gates compare them with the thresholds.
   With no thresholds anywhere, every case must pass.

The report also counts false refusals (a case that should be served was refused, excluding the pack's `gateReasons` such as an allowance cap) and missed refusals (a case that should be refused was served).

## Assertions

Paths are JSONPath (`$`, `.key`, `['key']`, `[0]`, `[*]`, `..key`) over `{ outcome, reason, detail, output, steps, raw }`, where `raw` is the app's whole response.

| Type | Example |
| --- | --- |
| `jsonPath` | `{ "path": "$.output[*].total_minutes", "op": "lte", "value": 20 }`; ops: equals, notEquals, includes, excludes, lte, gte, exists, absent |
| `count` | `{ "path": "$.output", "max": 1 }` counts an array's items, or the matches |
| `regexAbsent` / `regexPresent` | `{ "pattern": "cilantro", "path": "$.output[*].ingredients[*].name" }`, case-insensitive by default |
| `stepPresent` | `{ "name": "repairing" }` |

Any assertion takes `"when": ["served"]` to apply only to that outcome, so a case that may either decline or answer can still check the answer when there is one.

## Writing a pack

- `docs/contracts/stardust-config.v1.schema.json` and `stardust-dataset.v1.schema.json` describe the files; point `$schema` at them for editor checks.
  Regenerate them after changing `packages/targets/src/config.ts` with `pnpm --filter @cafe/targets schemas`.
- `${VAR}` and `${VAR:-default}` in the target are read from the environment, so secrets never live in the file.
- The first consumer is Palate: `recipe-builder/evals/`.
