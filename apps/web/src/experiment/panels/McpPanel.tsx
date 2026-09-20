import { useEffect, useState } from 'react'
import { fmtMs } from '../../format.js'
import { type ToolInfo, useExperimentApi } from '../../harness/index.js'
import type { SuiteDraft } from '../suite-draft.js'

/** The tool layer: what each role may call, and the chaos injected into calls. */
export function McpPanel({
  draft,
  onChange,
}: {
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
}) {
  const api = useExperimentApi()
  const [tools, setTools] = useState<{
    tools: ToolInfo[]
    roleScopes: Record<string, readonly string[]>
  } | null>(null)
  useEffect(() => {
    api
      ?.tools()
      .then(setTools)
      .catch(() => setTools(null))
  }, [api])
  const chaos = draft.chaos
  const set = (patch: Partial<SuiteDraft['chaos']>) =>
    onChange({ ...draft, chaos: { ...chaos, ...patch } })
  return (
    <div className="node-panel">
      <h3>MCP gateway</h3>
      <p className="muted small">
        Every tool call is scope-checked against the caller's role, timed, chaos-injected and
        recorded as an event and a span. External engines reach the same tools over{' '}
        <code>/mcp/:runId/:role</code>.
      </p>
      <h4>Chaos</h4>
      <label className="row">
        <span className="cap">tool error rate</span>
        <input
          type="range"
          min={0}
          max={0.8}
          step={0.05}
          value={chaos.toolErrorRate}
          onChange={(e) => set({ toolErrorRate: Number(e.target.value) })}
        />
        <span className="muted">{Math.round(chaos.toolErrorRate * 100)}%</span>
      </label>
      <label className="row">
        <span className="cap">tool latency</span>
        <input
          type="range"
          min={0}
          max={5000}
          step={100}
          value={chaos.toolLatencyMs}
          onChange={(e) => set({ toolLatencyMs: Number(e.target.value) })}
        />
        <span className="muted">{fmtMs(chaos.toolLatencyMs)}</span>
      </label>
      <label className="row">
        <span className="cap">agent crash rate</span>
        <input
          type="range"
          min={0}
          max={0.8}
          step={0.05}
          value={chaos.agentCrashRate}
          onChange={(e) => set({ agentCrashRate: Number(e.target.value) })}
        />
        <span className="muted">{Math.round(chaos.agentCrashRate * 100)}%</span>
      </label>
      <label className="row">
        <span className="cap">seed</span>
        <input
          type="number"
          value={chaos.seed}
          onChange={(e) => set({ seed: Number(e.target.value) })}
        />
      </label>
      <h4>Tool slices</h4>
      {tools ? (
        <div className="table-scroll">
          <table className="grid small">
            <thead>
              <tr>
                <th>tool</th>
                <th>scope</th>
                <th>who</th>
              </tr>
            </thead>
            <tbody>
              {tools.tools.map((t) => (
                <tr key={t.name}>
                  <td title={t.description}>
                    <code>{t.name}</code>
                  </td>
                  <td>{t.scope}</td>
                  <td>
                    {Object.entries(tools.roleScopes)
                      .filter(([, scopes]) => scopes.includes(t.scope))
                      .map(([role]) => role)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">Tool catalogue unavailable.</p>
      )}
    </div>
  )
}
