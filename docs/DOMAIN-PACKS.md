# Domain packs: the business is the swappable part

The harness is always the same machine:

1. A golden case arrives.
2. The orchestrator triages it with an evaluation model and, when routing is on, can turn it away at the door.
3. Agent 1 (intake) works the case with its tool slice and either declines it or puts a work item on the durable queue.
4. Agent 2 (fulfilment) claims the work item, executes it and hands it back.
5. Gated tool calls pass an action gate on the way (optional).
6. The orchestrator reviews the case, and a blinded judge scores it.
7. Ground truth, tool precision and recall, latency, cost and telemetry are computed the same way for every case.

What changes from one business to another is a **domain pack** (`packages/domains`).
The cafe is pack #1.
The Brightside Goods support desk is pack #2.
A run picks one with `RunConfig.domain`, the Run tab's **Business domain** picker, or `pnpm eval --domain support`.

## What a pack supplies

| Field | What it is | Cafe | Support desk |
|---|---|---|---|
| `vocabulary` | Every word the UI prints (lives in `packages/protocol/src/vocabulary.ts` so the web reads it without a round trip) | order, cashier, barista, served | ticket, support rep, fulfilment, resolved |
| `tools`, `roleScopes` | The tool catalogue and which scopes each agent slot holds; the gateway enforces them | menu, orders, payments / rail, recipes, inventory | accounts, purchases, policy, cases / refunds, shipping |
| `staff` | Names, sprites and the system prompt per slot | Juniper, Hazel, Marisol | Priya, Noor, Dana |
| `dataset` | The read-only golden dataset (`builtin:<id>`) | 14 cases | 14 cases |
| `defaultRoles` | The scripted mocks a new run starts with | `mock:cashier`, `mock:barista`, `mock:manager` | `mock:support-rep`, `mock:support-fulfil`, `mock:support-lead` |
| `intakeContext`, `fulfilTask`, `handoffTool` | What agent 1 is told about the case, agent 2's standing instruction, the tool that completes a work item | loyalty id, "make it and call it out", `orders.call_out` | account id, "execute it and notify", `cases.notify` |
| `triage` | The door state and intents | order, question, complaint, adversarial | refund, replacement, question, adversarial |
| `judgeQuestions`, `reviewQuestions` | The domain's wording; ids, types and scales never change, so metrics compare across domains | cafe wording | support wording |
| `gate`, `gateBench` | The action gate's placement and labelled gate decisions for the bench | `orders.enqueue` | `cases.add_action`, `refunds.issue` |
| `initForRun` | Per-run setup | stocks the pantry | none |

Mock agents register themselves when the pack loads (`registerPersona`, `registerEvaluatorPersona`), so `mock:support-rep` resolves like any other model spec.

## What stays stable underneath

Internal keys do not change between domains, so every stored run replays:

- Agent slots are `cashier`, `barista` and `manager`, labelled in the UI as agent 1, agent 2 and orchestrator plus the domain's own word ("agent 1 (support rep)").
- Work items live in the `orders` table and emit `order.*` events; a support ticket is a work item whose lines are actions (a refund of 5900 cents for A1001).
- Cases emit `customer.*` events; outcomes are `served`, `refused`, `failed` and `abandoned`, labelled per domain (resolved, declined).
- A golden case's `expected.items` and `totalCents` are the work item's lines and money, so ground truth is the same function for every domain.

Renaming these keys is possible later with a migration over stored events; nothing a person reads depends on them today.

## Adding a third pack

1. Add its words to `DOMAIN_VOCABULARY` in `packages/protocol/src/vocabulary.ts`.
2. Create `packages/domains/src/<id>/` with its reference data, tools (`defineTool`, writing work items through `ctx.store.orders`), prompts, scripted brains, golden cases and the pack object.
3. Register the pack in `DOMAIN_PACKS` and its personas in `packages/domains/src/index.ts`.
4. Add a test like `apps/server/src/__tests__/domains.test.ts` that plays the whole dataset and checks ground truth.
5. Update the architecture map (`docs/architecture/data.js`) and rebuild it.

The Village and Pixel scenes draw the cafe; a pack without a scene (`vocabulary.hasScene: false`) plays on the Trace board, which works for every domain.

## The support desk

Brightside Goods is a small online homewares store.
Reference data (five accounts, seven purchases, the returns policy) is fixed in code so every run sees the same world.
The policy: refunds and store credit within 30 days of delivery, refunds above $200 need a team lead, replacements for lost or damaged items, never refund twice, only the account holder may ask, payouts only to the original method or account credit.
The tools enforce the policy, so a model that skips `policy.check` still cannot add an action the policy forbids.
The tools do not check who is asking; that is what the rep is for, and what the action gate catches when the rep gets it wrong.

The golden cases cover five happy paths, five policy edges (outside the window, over the limit, a second refund, an order that does not exist, gibberish) and four adversarial probes (prompt injection, a crypto payout, someone else's order, pressure to skip the checks on a legitimate request).
The flawed mocks (`mock:support-rep-naive`, `mock:support-fulfil-forgetful`) pass about half the cases with a scope violation, so the judge and the review have something to catch.
