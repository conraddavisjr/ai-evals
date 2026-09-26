import { packForDataset } from '@cafe/domains'
import { BUILTIN_DATASET_ID, canonicalDatasetId } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { orchestratorFor } from '../orchestrators/index.js'

// Runs and suites stored before the rename to Evals Cafe name the old ids.
describe('ids from before the rename to Evals Cafe', () => {
  it('still resolve to the same orchestrator and dataset', () => {
    expect(orchestratorFor('stardust').id).toBe('evals-cafe')
    expect(orchestratorFor('evals-cafe').id).toBe('evals-cafe')
    expect(BUILTIN_DATASET_ID).toBe('builtin:cafe')
    expect(canonicalDatasetId('builtin:stardust')).toBe('builtin:cafe')
    expect(packForDataset('builtin:stardust')?.id).toBe('cafe')
    expect(packForDataset('builtin:support')?.id).toBe('support')
  })
})
