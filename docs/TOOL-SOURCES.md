# Tool sources: evaluating agents against a different MCP

The harness does not care which system the agents work against.
The gateway (`packages/mcp-gateway`) sits between every agent and every tool; the tools it holds are a catalogue it is given, and that catalogue can come from anywhere.

## Two sources today

- `{ "kind": "builtin" }` (default): the cafe's own tools, in-process, against Postgres.
  Latencies you see for these are real database round-trips (3 to 20 ms locally), not simulation; only the mock models' *thinking* time is paced, and chaos latency is opt-in.
- `{ "kind": "mcp", "url": "...", "headers": {...}, "roleTools": { "cashier": ["..."], "barista": ["..."] } }`: any MCP server over streamable HTTP.
  At run start the gateway lists the server's tools, advertises each tool's own JSON Schema to the models, and forwards every call over the wire.
  Scope checks, timing, chaos, events and spans still happen in the gateway; the work, and the database behind it, happen on the other side.

`roleTools` says which remote tools each role may call. A role's scope is exactly that list; anything else is a scope violation, recorded like any other.

## Example

```json
{
  "name": "agents against the orders service",
  "scenarioIds": ["latte-simple"],
  "roles": { "cashier": "anthropic/claude-sonnet-5", "barista": "mock:barista", "manager": "mock:manager", "judge": "mock:judge" },
  "tools": {
    "kind": "mcp",
    "url": "https://orders.internal/mcp",
    "headers": { "authorization": "Bearer ..." },
    "roleTools": {
      "cashier": ["catalog.search", "orders.create", "orders.add_line", "payments.charge"],
      "barista": ["orders.claim", "orders.complete"]
    }
  }
}
```

## What still assumes the cafe

- The built-in scenarios expect the cafe's tool names (`expected.cashierTools`), so grading by expected tools needs a golden dataset written for the remote catalogue; the outcome grading (`served` / `refused` / `failed`) comes from the cafe's order events and will need an outcome adapter per engine (see `docs/ORCHESTRATORS.md`).
- The mock staff brains only know the cafe menu; use live models against a remote catalogue.
- The manager's own tools (`staffing.*`, `orders.requeue`) are cafe-specific and are not advertised when the source is remote.

## Test

`packages/mcp-gateway/src/__tests__/gateway.test.ts` ("remote MCP tool source") points a gateway at another MCP server (this cafe's own, over an in-memory transport) and drives real calls through it: listing, a successful call that reads the database, a locally enforced scope violation, and a remote failure surfacing as a domain error.
