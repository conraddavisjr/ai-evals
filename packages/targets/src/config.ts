import { z } from 'zod'

/**
 * A config pack: everything the harness needs to evaluate another project's AI,
 * in one JSON file that lives in that project (`evals/stardust.config.json`).
 * The project describes how to call it and what "right" looks like; the harness
 * never imports the project's code, it only talks to a URL.
 */
export const CONFIG_CONTRACT = 1

/** The harness's canonical three outcomes, whatever the target calls them. */
export const Outcome = z.enum(['served', 'refused', 'failed'])
export type Outcome = z.infer<typeof Outcome>

export const HttpTargetConfig = z.object({
  kind: z.literal('http'),
  /** `${VAR}` and `${VAR:-default}` are read from the environment. */
  url: z.string(),
  method: z.enum(['POST', 'PUT']).default('POST'),
  headers: z.record(z.string(), z.string()).default({}),
  /** The request body; a string that is exactly `{{input.prompt}}` keeps the value's type. */
  bodyTemplate: z.unknown(),
  /** JSONPaths into the response, and how the target's outcome words map to the canonical three. */
  responseMap: z.object({
    outcome: z.string(),
    outcomeMap: z.record(z.string(), Outcome),
    reason: z.string().optional(),
    detail: z.string().optional(),
    output: z.string().optional(),
    steps: z.string().optional(),
    usd: z.string().optional(),
    inputTokens: z.string().optional(),
    outputTokens: z.string().optional(),
    model: z.string().optional(),
  }),
  /** A JSON Schema file (relative to the config) every response must satisfy: the contract test. */
  responseSchema: z.string().optional(),
  timeoutMs: z.number().int().positive().default(120_000),
  concurrency: z.number().int().positive().default(2),
})
export type HttpTargetConfig = z.infer<typeof HttpTargetConfig>

/** `true` means the judge must say yes, `false` no; `{ min }` / `{ max }` bound a 1 to 5 score. */
export const JudgeExpectation = z.union([
  z.boolean(),
  z
    .object({ min: z.number().min(1).max(5).optional(), max: z.number().min(1).max(5).optional() })
    .refine((v) => v.min !== undefined || v.max !== undefined, 'give min or max'),
])
export type JudgeExpectation = z.infer<typeof JudgeExpectation>

export const JudgeQuestion = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('boolean'), instructions: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal('score'),
    instructions: z.string(),
    /** Five levels, worst first. */
    criteria: z
      .array(z.string())
      .length(5)
      .default(['very poor', 'poor', 'acceptable', 'good', 'excellent']),
  }),
])
export type JudgeQuestion = z.infer<typeof JudgeQuestion>

export const PackConfig = z.object({
  $schema: z.string().optional(),
  contract: z.literal(CONFIG_CONTRACT),
  name: z.string(),
  /** The slug the dashboard groups this project's runs under; from the name when omitted. */
  project: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes')
    .optional(),
  description: z.string().optional(),
  /**
   * Words for the dashboard: what the app is called, what a result is, what its
   * outcomes and pipeline stages are called (roles.cashier is the drafter, roles.barista the reviewer).
   */
  vocabulary: z.record(z.string(), z.unknown()).default({}),
  /** Which of the app's reported step names are the router, agent 1 and agent 2 on the board. */
  pipeline: z
    .object({
      router: z.array(z.string()).optional(),
      agent1: z.array(z.string()).optional(),
      agent2: z.array(z.string()).optional(),
    })
    .optional(),
  target: HttpTargetConfig,
  /** Dataset files, relative to the config; `*` globs are allowed. */
  datasets: z.array(z.string()).min(1),
  /**
   * Reasons that come from a deterministic gate in the app (an allowance cap),
   * not from the model: kept out of the false-refusal count.
   */
  gateReasons: z.array(z.string()).default([]),
  judge: z
    .object({
      model: z.string(),
      questions: z.array(JudgeQuestion).min(1),
      /** Expectations every case carries unless it overrides them. */
      defaults: z.record(z.string(), JudgeExpectation).default({}),
      /** The output is cut to this many characters of JSON before the judge reads it. */
      maxOutputChars: z.number().int().positive().default(24_000),
    })
    .optional(),
  thresholds: z
    .object({
      overall: z.number().min(0).max(1).optional(),
      byTag: z.record(z.string(), z.number().min(0).max(1)).default({}),
    })
    .default({ byTag: {} }),
  budget: z.object({ maxUsdPerRun: z.number().positive().optional() }).default({}),
  repeats: z.number().int().positive().default(1),
})
export type PackConfig = z.infer<typeof PackConfig>

/** Fields every assertion takes: a label, and the outcomes it applies to. */
const common = {
  note: z.string().optional(),
  /** Only check when the outcome is one of these; otherwise the check is skipped (a decline has no recipe to inspect). */
  when: z.array(Outcome).min(1).optional(),
}

/** One check that runs on the target's answer before any judge is asked. */
export const Assertion = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('jsonPath'),
    path: z.string(),
    op: z.enum(['equals', 'notEquals', 'includes', 'excludes', 'lte', 'gte', 'exists', 'absent']),
    value: z.unknown().optional(),
    ...common,
  }),
  z.object({
    type: z.literal('count'),
    path: z.string(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
    ...common,
  }),
  z.object({
    type: z.enum(['regexAbsent', 'regexPresent']),
    pattern: z.string(),
    flags: z.string().default('i'),
    /** What to search, as JSONPath; the whole output by default. */
    path: z.string().default('$.output'),
    ...common,
  }),
  z.object({ type: z.literal('stepPresent'), name: z.string(), ...common }),
])
export type Assertion = z.infer<typeof Assertion>

export const EvalCase = z.object({
  id: z.string().regex(/^[\w.-]+$/, 'letters, digits, dot, dash, underscore'),
  title: z.string(),
  tags: z.array(z.string()).default([]),
  /** Filled into the target's body template as `input.*`. */
  input: z.record(z.string(), z.unknown()),
  expect: z
    .object({
      /** One outcome, or any of several. */
      outcome: z.union([Outcome, z.array(Outcome).min(1)]).optional(),
      /** When refused or failed, the reason must be one of these. */
      reason: z.array(z.string()).optional(),
      assertions: z.array(Assertion).default([]),
    })
    .default({ assertions: [] }),
  /** What a good answer looks like, for the judge. */
  rubric: z.string().optional(),
  judge: z.record(z.string(), JudgeExpectation).default({}),
  /**
   * Decide this case on the deterministic checks alone. For requests a judge's
   * provider will not read (weapons, poisons), where a clean decline is the proof.
   */
  skipJudge: z.boolean().default(false),
  /** Part of the fast subset a pull request runs. */
  smoke: z.boolean().default(false),
})
export type EvalCase = z.infer<typeof EvalCase>

export const DatasetFile = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  /** Added to every case in the file. */
  tags: z.array(z.string()).default([]),
  cases: z.array(EvalCase).min(1),
})
export type DatasetFile = z.infer<typeof DatasetFile>
