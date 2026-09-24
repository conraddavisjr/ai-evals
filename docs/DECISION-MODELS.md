# Decision models: where Jev fits, and how to compare it

TypeSafe's Jev is a "System One" decision model.
It takes a state and typed questions (yes/no, a choice, a score) and returns typed answers with calibrated probabilities.
It answers in roughly 70 to 500 ms, bills input tokens only, and writes no text and calls no tools.
That makes it a poor agent and a strong decision point.

In this harness every decision point goes through the AI SDK's `experimental_evaluate`.
Jev, Claude, GPT, Gemini and open-weights models (through `llm-evaluation-adapter.ts`) are therefore interchangeable at each one, with an identical question set.

## The decision points

| Point | Where | What it decides | Why a decision model suits it |
|---|---|---|---|
| Door triage | `ShiftOrchestrator.triage` | The case's intent (a choice) and whether to escalate | Runs on every case before any agent spends a token; latency and price add up |
| Triage routing | `RunConfig.triageRoutes` | Turn manipulation away before agent 1 sees it | A router: a wrong "no" costs a customer, a wrong "yes" costs an agent run and a risk; calibration sets the threshold |
| Action gate | `RunConfig.gate`, the pack's `gate` | Approve or block a gated tool call (a payout, a hand-off) before it runs | Inline in the agent loop, so every millisecond is on the critical path; a probability, not prose, is what a threshold needs |
| Orchestrator review | `reviewTransaction` | File the case as ok, concern or escalate, plus typed issues | Typed labels over a long trail |
| Judge | `judgeTransaction` | Correctness, refusal appropriateness, 1 to 5 scores | Calibrated confidence rather than a verdict you cannot threshold |

Agents 1 and 2 need a chat model with tool use; Jev never sits in their chairs.

### Turning them on

- Run tab, **Decision points**: route adversarial cases away at the door, and turn on the action gate with its own model and approve threshold.
- CLI: `pnpm eval --domain support --route --gate gateway:typesafe-ai/jev`.
- Config: `{ "triageRoutes": true, "gate": { "enabled": true, "modelSpec": "gateway:typesafe-ai/jev", "threshold": 0.5 } }`.

The gate fails closed: if the model cannot answer, the call is blocked and an `agent.error` records why.
Every decision is an event (`triage.decided` with `routed`, `guard.decided` with P(approve), spec and latency), a span (`triage`, `gate`) and a usage row with its cost.
On the Trace board a gate decision is a badge right under the call it judged.

With the scripted mocks, the naive support rep passes about half the cases on its own.
With routing and the gate on, the same naive rep passes all of them: manipulation is turned away at the door, and a payout for someone else's order is blocked before it runs.

## Comparing Jev with other models

There are two ways, and they answer different questions.

**The decision bench** (menu, **Decision bench**; or `pnpm eval --bench`) asks the same labelled decisions of up to five evaluation models, with no agents in the loop.
It is fast and cheap: a few dozen evaluate calls per model.

- Door guardrail: each golden case's opening line; the right answer is "turn away" only for adversarial cases that should be refused.
- Action gate: from the pack's rules (`gateBench()`); for the support desk, every purchase against every action as asked by its owner (the label is the returns policy), plus requests from someone else and payouts redirected to gift cards.
- Judge: the judged cases of a finished run with the ground-truth fields removed from the transcript; the label is the ground truth. Pick a run with the flawed mocks for a balanced set.

For each model and decision point it reports accuracy, precision, recall, Brier score (calibration: 0 is perfect, 0.25 is a coin at 50%), p50 and p95 latency, cost and errors, plus pairwise agreement and every decision any model got wrong.
The chart puts accuracy against median latency with a whisker to p95, so a fast, accurate model sits up and to the left.

```sh
pnpm eval --bench --domain support \
  --specs mock:support-lead,gateway:typesafe-ai/jev,anthropic/claude-haiku-4-5-20251001,anthropic/claude-sonnet-5 \
  --tasks door,gate
```

**Suites** (the Experiment page) answer the end-to-end question: what happens to pass rate, cost and latency when Jev replaces an LLM as orchestrator, gate or judge.
A variant that overrides the orchestrator's model also moves triage, routing and the gate unless the gate has its own spec.

### Reading the numbers

- The scripted mocks are keyword rules written against these very datasets. They are a floor for the policy-heavy gate and an upper bound on memorisation at the door, not a model.
- Accuracy at a fixed 50% threshold hides calibration; compare Brier too. A model that says 55% when unsure is more useful to a router than one that says 99% and is wrong one time in ten.
- Latency matters most at the gate, where it adds to every gated call, and least at the judge, which runs after the case is over.
- Jev needs `AI_GATEWAY_API_KEY` (the Vercel AI Gateway is its only route today) and `CAFE_ALLOW_LIVE_MODELS=true`.

## Places not built yet

- A loop monitor: ask after each agent step whether the agent is stuck or repeating itself, and stop it early.
- Tool selection: ask which of the agent's tools fits the next step, as a hint or a constraint.
- Per-intent routing to different agent pools (a refunds specialist versus a general rep), using the triage choice rather than only the adversarial flag.
