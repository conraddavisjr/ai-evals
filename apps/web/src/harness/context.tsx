import { createContext, type ReactNode, useContext } from 'react'
import type { ExperimentClient, HarnessClient } from './types.js'

const HarnessContext = createContext<HarnessClient | null>(null)

/** Hands the UI its event source. Swap the client here to point the cafe at another harness. */
export function HarnessProvider({
  client,
  children,
}: {
  client: HarnessClient
  children: ReactNode
}) {
  return <HarnessContext.Provider value={client}>{children}</HarnessContext.Provider>
}

export function useHarness(): HarnessClient {
  const client = useContext(HarnessContext)
  if (!client) throw new Error('useHarness must be used inside <HarnessProvider>')
  return client
}

/** The experiment features, when the provided client implements them. */
export function useExperimentApi(): ExperimentClient | null {
  const client = useContext(HarnessContext) as (HarnessClient & Partial<ExperimentClient>) | null
  if (!client) throw new Error('useExperimentApi must be used inside <HarnessProvider>')
  return typeof client.telemetry === 'function'
    ? (client as HarnessClient & ExperimentClient)
    : null
}
