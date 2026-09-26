import { describe, expect, it } from 'vitest'
import type { ModelsInfo } from '../harness/index.js'
import {
  addVariant,
  anyLiveModel,
  effectiveRoles,
  estimateSuiteUsd,
  initialSuiteDraft,
  toSuiteConfig,
} from './suite-draft.js'

const models = {
  allowLive: false,
  presets: {},
  personas: [],
  providersConfigured: {},
  defaults: {
    name: 'shift',
    orchestrator: 'evals-cafe',
    scenarioIds: ['a'],
    roles: {
      cashier: 'mock:cashier',
      barista: 'mock:barista',
      manager: 'mock:manager',
      judge: 'mock:judge',
    },
    staffing: { cashiers: 2, baristas: 1 },
    chaos: { toolErrorRate: 0, toolLatencyMs: 0, agentCrashRate: 0, crashRoles: [], seed: 42 },
    budget: {
      maxStepsPerAgent: 12,
      maxTokensPerAgent: 20000,
      maxUsdPerRun: 0.5,
      agentTimeoutMs: 90000,
    },
    arrivalGapMs: 1500,
    judgeEnabled: true,
    triageEnabled: true,
    reviewEnabled: true,
    mockPacing: { llmStepMs: [0, 0], toolMs: [0, 0], hangOrders: [], hangMs: 0 },
  },
} as unknown as ModelsInfo

describe('suite draft', () => {
  it('starts with one baseline variant on the first dataset and instant pacing', () => {
    const d = initialSuiteDraft(models, [
      {
        id: 'builtin:cafe',
        name: 'x',
        description: '',
        builtin: true,
        itemCount: 14,
        updatedAt: 0,
      },
    ])
    expect(d.datasetId).toBe('builtin:cafe')
    expect(d.variants).toEqual([{ name: 'baseline', roles: {} }])
    expect(toSuiteConfig(d).base.mockPacing?.llmStepMs).toEqual([0, 0])
  })
  it('adds variants with unique names that inherit the base roles until overridden', () => {
    let d = initialSuiteDraft(models, [])
    d = addVariant(addVariant(d))
    expect(d.variants.map((v) => v.name)).toEqual(['baseline', 'variant 2', 'variant 3'])
    const v = { name: 'sonnet judge', roles: { judge: 'anthropic/claude-sonnet-5' } }
    expect(effectiveRoles(d, v).judge).toBe('anthropic/claude-sonnet-5')
    expect(effectiveRoles(d, v).cashier).toBe('mock:cashier')
    expect(anyLiveModel({ ...d, variants: [v] })).toBe(true)
    expect(anyLiveModel(d)).toBe(false)
  })
  it('estimates cost across variants, repeats and items', () => {
    const d = initialSuiteDraft(models, [])
    expect(estimateSuiteUsd(d, 14)).toBe(0)
    const live = {
      ...d,
      repeats: 2,
      variants: [{ name: 'sonnet', roles: { judge: 'anthropic/claude-sonnet-5' } }],
    }
    const one = estimateSuiteUsd({ ...live, repeats: 1 }, 10)
    expect(one).toBeGreaterThan(0)
    expect(estimateSuiteUsd(live, 10)).toBeCloseTo(one * 2, 10)
  })
})
