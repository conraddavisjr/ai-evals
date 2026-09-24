import type { DatasetSummary, SuiteDetail } from '@cafe/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shortModel } from '../format.js'
import {
  type DomainInfo,
  type ModelsInfo,
  type OrchestratorInfo,
  useExperimentApi,
} from '../harness/index.js'
import { describeSpec } from '../lib/nomenclature.js'
import { PipelineDiagram } from './PipelineDiagram.js'
import { AgentPanel } from './panels/AgentPanel.js'
import { DatasetPanel } from './panels/DatasetPanel.js'
import { JudgePanel } from './panels/JudgePanel.js'
import { McpPanel } from './panels/McpPanel.js'
import { OrchestratorPanel } from './panels/OrchestratorPanel.js'
import type { PipelineNodeId } from './pipeline-data.js'
import { SuiteConfigPanel } from './SuiteConfigPanel.js'
import { SuiteList } from './SuiteList.js'
import { SuiteResults } from './SuiteResults.js'
import { type SuiteDraft, toSuiteConfig } from './suite-draft.js'
import './experiment.css'

type Tab = 'config' | 'suites' | 'results'

/**
 * The experiment workbench: an interactive pipeline diagram whose nodes open the
 * controls for that layer, the suite (variants) beside it, and the results of
 * every suite that ran.
 */
export function ExperimentPage({
  models,
  domains,
  draft,
  onDraftChange,
  onOpenRun,
}: {
  models: ModelsInfo
  domains: DomainInfo[]
  draft: SuiteDraft
  onDraftChange: (d: SuiteDraft) => void
  onOpenRun: (runId: string) => void
}) {
  const api = useExperimentApi()
  const [selected, setSelected] = useState<PipelineNodeId | null>('dataset')
  const [tab, setTab] = useState<Tab>('config')
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [orchestrators, setOrchestrators] = useState<OrchestratorInfo[]>([])
  const [suites, setSuites] = useState<SuiteDetail[]>([])
  const [suiteId, setSuiteId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const refreshDatasets = useCallback(() => {
    api
      ?.datasets()
      .then(setDatasets)
      .catch(() => {})
  }, [api])
  const refreshSuites = useCallback(() => {
    api
      ?.suites()
      .then(setSuites)
      .catch(() => {})
  }, [api])
  useEffect(() => {
    refreshDatasets()
    api
      ?.orchestrators()
      .then(setOrchestrators)
      .catch(() => {})
  }, [api, refreshDatasets])
  useEffect(() => {
    refreshSuites()
    const id = setInterval(refreshSuites, 4000)
    return () => clearInterval(id)
  }, [refreshSuites])

  const dataset = datasets.find((d) => d.id === draft.datasetId)
  const itemCount = draft.itemIds ? draft.itemIds.length : (dataset?.itemCount ?? 0)
  const selectedSuite = suites.find((s) => s.id === suiteId) ?? null

  const summaries = useMemo<Partial<Record<PipelineNodeId, string>>>(
    () => ({
      dataset: dataset
        ? `${dataset.name} · ${itemCount} item${itemCount === 1 ? '' : 's'}`
        : 'Pick a dataset',
      orchestrator: `${orchestrators.find((o) => o.id === draft.orchestrator)?.label ?? draft.orchestrator} · ${shortModel(draft.roles.manager)} (${describeSpec(draft.roles.manager)})`,
      cashier: `${shortModel(draft.roles.cashier)} · ${draft.staffing.cashiers} running`,
      barista: `${shortModel(draft.roles.barista)} · ${draft.staffing.baristas} running`,
      mcp:
        draft.chaos.toolErrorRate > 0 ||
        draft.chaos.agentCrashRate > 0 ||
        draft.chaos.toolLatencyMs > 0
          ? `chaos: ${Math.round(draft.chaos.toolErrorRate * 100)}% tool errors · ${Math.round(draft.chaos.agentCrashRate * 100)}% crashes · +${draft.chaos.toolLatencyMs}ms`
          : 'no chaos · scoped tool slices',
      review: draft.reviewEnabled ? `${shortModel(draft.roles.manager)} reviews every case` : 'off',
      judge: draft.judgeEnabled ? shortModel(draft.roles.judge) : 'off',
      telemetry: `${draft.variants.length} variant${draft.variants.length === 1 ? '' : 's'} × ${itemCount} items`,
    }),
    [dataset, itemCount, orchestrators, draft],
  )

  const runSuite = async () => {
    if (!api) return
    setStarting(true)
    setStartError(null)
    try {
      const { suiteId: id } = await api.startSuite(toSuiteConfig(draft))
      setSuiteId(id)
      setTab('results')
      refreshSuites()
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  if (!api)
    return (
      <div className="expv">
        <p className="muted">This harness does not expose experiments.</p>
      </div>
    )

  return (
    <div className="expv">
      <div className="exp-top">
        <h2>Experiment</h2>
        <span className="muted">
          Click a layer to configure it. Variants on the right each loop the whole dataset.
        </span>
        <span className="spacer" />
        <nav className="tabs exp-tabs">
          {(
            [
              ['config', 'Suite config'],
              ['suites', `Suites${suites.length ? ` (${suites.length})` : ''}`],
              ['results', 'Results'],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="exp-body">
        <div className="exp-left">
          <div className="exp-diagram">
            <PipelineDiagram
              domain={draft.domain}
              selected={selected}
              onSelect={setSelected}
              summaries={summaries}
            />
          </div>
          <div className="exp-node">
            {selected === null && (
              <p className="muted">Select a layer in the diagram to see its controls.</p>
            )}
            {selected === 'dataset' && (
              <DatasetPanel
                domains={domains}
                draft={draft}
                onChange={onDraftChange}
                datasets={datasets}
                onDatasetsChanged={refreshDatasets}
              />
            )}
            {selected === 'orchestrator' && (
              <OrchestratorPanel
                draft={draft}
                onChange={onDraftChange}
                models={models}
                orchestrators={orchestrators}
              />
            )}
            {(selected === 'cashier' || selected === 'barista') && (
              <AgentPanel role={selected} draft={draft} onChange={onDraftChange} models={models} />
            )}
            {selected === 'mcp' && <McpPanel draft={draft} onChange={onDraftChange} />}
            {selected === 'review' && (
              <OrchestratorPanel
                draft={draft}
                onChange={onDraftChange}
                models={models}
                orchestrators={orchestrators}
              />
            )}
            {selected === 'judge' && (
              <JudgePanel draft={draft} onChange={onDraftChange} models={models} />
            )}
            {selected === 'telemetry' && (
              <div className="node-panel">
                <h3>Spans + metrics</h3>
                <p className="muted small">
                  Every run is traced (case, turn, step, tool call, review, judge) and rolled up. A
                  suite compares its variants side by side: pass rate, refusals, tool precision,
                  latency, judge and review verdicts, cost, and an item × variant grid.
                </p>
                <button type="button" onClick={() => setTab('results')}>
                  Open results
                </button>
              </div>
            )}
          </div>
        </div>
        <aside className="exp-right">
          {tab === 'config' && (
            <SuiteConfigPanel
              draft={draft}
              onChange={onDraftChange}
              models={models}
              orchestrators={orchestrators}
              itemCount={itemCount}
              onRun={() => void runSuite()}
              running={starting}
              error={startError}
            />
          )}
          {tab === 'suites' && (
            <SuiteList
              suites={suites}
              selectedId={suiteId}
              onSelect={(id) => {
                setSuiteId(id)
                setTab('results')
              }}
              onChanged={refreshSuites}
            />
          )}
          {tab === 'results' &&
            (selectedSuite ? (
              <SuiteResults suite={selectedSuite} onOpenRun={onOpenRun} />
            ) : (
              <p className="muted">
                Run a suite, or pick one under Suites, to see the comparison here.
              </p>
            ))}
        </aside>
      </div>
    </div>
  )
}
