import type { Scenario } from '@cafe/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchitectureView } from './architecture/ArchitectureView.js'
import { AgentInspector } from './components/AgentInspector.js'
import { EventLog } from './components/EventLog.js'
import { MetricsDashboard } from './components/MetricsDashboard.js'
import { PlaybackControls } from './components/PlaybackControls.js'
import { QueuePanel } from './components/QueuePanel.js'
import { RunConfigPanel } from './components/RunConfigPanel.js'
import { initialDraft, type RunDraft, toRunConfig } from './components/run-draft.js'
import { TransactionList } from './components/TransactionList.js'
import { usePanelWidth } from './components/usePanelWidth.js'
import { ExperimentPage } from './experiment/ExperimentPage.js'
import { initialSuiteDraft, type SuiteDraft } from './experiment/suite-draft.js'
import { fmtUsd } from './format.js'
import { type ModelsInfo, type RunRow, useExperimentApi, useHarness } from './harness/index.js'
import { TimelinePlayer } from './playback/TimelinePlayer.js'
import { usePlayer } from './playback/usePlayer.js'
import { DEFAULT_VIEW_ID, findView, SCENE_VIEWS, type SceneHandle } from './views/index.js'

type Tab = 'run' | 'inspector' | 'queue' | 'visits' | 'metrics' | 'log'
const VIEW_KEY = 'cafe.sceneView'

// One player per page, surviving Vite HMR so a live stream is never orphaned mid-run.
const hotData = import.meta.hot?.data as { player?: TimelinePlayer } | undefined
const player: TimelinePlayer = hotData?.player ?? new TimelinePlayer()
if (hotData) hotData.player = player

export function App() {
  usePlayer(player)
  const api = useHarness()
  const mountRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<SceneHandle | null>(null)
  const [models, setModels] = useState<ModelsInfo | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [draft, setDraft] = useState<RunDraft | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string>('idle')
  const [isLive, setIsLive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('run')
  const [page, setPage] = useState<'cafe' | 'experiment' | 'architecture'>('cafe')
  const [suiteDraft, setSuiteDraft] = useState<SuiteDraft | null>(null)
  const experiment = useExperimentApi()
  const [sceneId, setSceneId] = useState<string>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) ?? DEFAULT_VIEW_ID
    } catch {
      return DEFAULT_VIEW_ID
    }
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const closeStream = useRef<(() => void) | null>(null)

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) setTab('inspector')
  }, [])
  /** Select without leaving the current tab (the Log's nested pane). */
  const onPeek = useCallback((id: string | null) => setSelectedId(id), [])
  const panel = usePanelWidth()

  useEffect(() => {
    Promise.all([api.models(), api.scenarios()])
      .then(([m, s]) => {
        setModels(m)
        setScenarios(s)
        setDraft(initialDraft(m, s))
        experiment
          ?.datasets()
          .then((ds) => setSuiteDraft(initialSuiteDraft(m, ds)))
          .catch(() => setSuiteDraft(initialSuiteDraft(m, [])))
      })
      .catch((e) =>
        setBootError(
          `Cannot reach the server: ${e instanceof Error ? e.message : e}. Is \`pnpm dev\` running?`,
        ),
      )
  }, [api, experiment])

  // Mount the chosen view; switching tears the old one down and the new one snaps to player.state.
  useEffect(() => {
    const parent = mountRef.current
    if (!parent) return
    const view = findView(sceneId)
    let handle: SceneHandle | null = null
    let cancelled = false
    void view.mount(parent, player, { onSelect }).then((h) => {
      // the user switched again while the renderer was still loading
      if (cancelled) return h.destroy()
      handle = h
      gameRef.current = h
      if (import.meta.env.DEV)
        (window as unknown as { __cafe: unknown }).__cafe = { player, game: h, view: view.id }
    })
    return () => {
      cancelled = true
      handle?.destroy()
      gameRef.current = null
    }
  }, [onSelect, sceneId])

  const chooseScene = useCallback((id: string) => {
    setSceneId(id)
    try {
      localStorage.setItem(VIEW_KEY, id)
    } catch {
      /* private mode: the choice just does not persist */
    }
  }, [])

  const attach = useCallback(
    (id: string, live: boolean, afterSeq = -1) => {
      closeStream.current?.()
      closeStream.current = null
      setRunId(id)
      setIsLive(live)
      setSelectedId(null)
      if (live) {
        setRunStatus('running')
        closeStream.current = api.stream(
          id,
          {
            onEvent: (e) => player.ingest([e]),
            onDone: (status) => {
              player.markComplete()
              setRunStatus(status)
              setIsLive(false)
            },
          },
          afterSeq,
        )
      }
    },
    [api],
  )

  /** Start the drafted shift. The one entry point behind every "Open the cafe" button. */
  const openCafe = useCallback(async () => {
    if (!draft) return
    setStartError(null)
    try {
      const { runId: id } = await api.startRun(toRunConfig(draft))
      player.reset()
      player.setMode('live-buffered')
      player.play()
      attach(id, true)
      setTab('visits')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStartError(msg)
      setTab('run')
      throw err
    }
  }, [api, attach, draft])

  const loadRun = useCallback(
    async (run: RunRow) => {
      closeStream.current?.()
      player.reset()
      const events = await api.events(run.id)
      if (run.active) {
        player.setMode('live-buffered')
        player.ingest(events)
        player.play()
        attach(run.id, true, events.at(-1)?.seq ?? -1)
      } else {
        player.setMode('replay')
        player.ingest(events)
        player.markComplete()
        player.seek(0)
        player.play()
        attach(run.id, false)
        setRunStatus(run.status)
      }
      setTab('visits')
    },
    [api, attach],
  )

  const cancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId)
  }, [api, runId])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu-wrap')) setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onClick)
    }
  }, [menuOpen])

  // Phaser sleeps in hidden tabs; keep the player (and the panels) current at a low rate meanwhile.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) player.tick(performance.now())
    }, 500)
    return () => clearInterval(id)
  }, [])

  // keyboard: space play/pause or next step; arrows step; 1-5 modes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (player.mode === 'step') player.stepForward()
        else if (player.playing) player.pause()
        else player.play()
      } else if (e.code === 'ArrowRight') player.stepForward()
      else if (e.code === 'ArrowLeft') player.stepBack()
      else if (e.key === '1') player.setMode('live-buffered')
      else if (e.key === '2') player.setMode('live-raw')
      else if (e.key === '3') player.setMode('replay')
      else if (e.key === '4') player.setMode('step')
      else if (e.key === '5') player.setMode('directors-cut')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const state = player.state
  const agentsList = Object.values(state.agents)
  const staffSummary = `${agentsList.filter((x) => x.role === 'cashier').length} cashiers · ${agentsList.filter((x) => x.role === 'barista').length} baristas`

  return (
    <div className="app">
      <header>
        <div className="menu-wrap">
          <button
            type="button"
            className={`hamburger ${menuOpen ? 'on' : ''}`}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
          {menuOpen && (
            <nav id="main-menu" className="menu" aria-label="Main">
              <button
                type="button"
                className={page === 'cafe' ? 'on' : ''}
                onClick={() => {
                  setPage('cafe')
                  setMenuOpen(false)
                }}
              >
                Cafe
              </button>
              <button
                type="button"
                className={page === 'experiment' ? 'on' : ''}
                onClick={() => {
                  setPage('experiment')
                  setMenuOpen(false)
                }}
              >
                Experiment
              </button>
              <button
                type="button"
                className={page === 'architecture' ? 'on' : ''}
                onClick={() => {
                  setPage('architecture')
                  setMenuOpen(false)
                }}
              >
                Architecture
              </button>
            </nav>
          )}
        </div>
        <div className="brand">
          <LanternMark />
          <div className="brand-text">
            <span className="title">Stardust Cafe</span>
            <span className="subtitle">agentic eval harness</span>
          </div>
        </div>
        <div className="segmented view-switch" role="tablist" aria-label="Scene style">
          {SCENE_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={sceneId === v.id}
              className={sceneId === v.id ? 'on' : ''}
              title={v.blurb}
              onClick={() => chooseScene(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="status">
          {runId ? (
            <>
              <span className={`pill ${runStatus}`}>{runStatus}</span>
              <span className="muted mono runid">{runId.slice(-8)}</span>
              <span className="muted staff">{staffSummary}</span>
              <span className="muted">
                {Object.values(state.customers).filter((c) => c.outcome === 'served').length} served
              </span>
              <span className="cost" title="Spend so far">
                {fmtUsd(state.costUsd)}
              </span>
              {isLive && (
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
              )}
            </>
          ) : (
            <span className="muted">no shift loaded</span>
          )}
          {!isLive && (
            <button
              type="button"
              className="primary open-cafe"
              disabled={!draft || draft.scenarioIds.length === 0}
              title={
                !draft
                  ? 'Waiting for the server'
                  : draft.scenarioIds.length === 0
                    ? 'Pick at least one customer in the Shift tab'
                    : 'Start a shift with the settings in the Shift tab'
              }
              onClick={() => void openCafe().catch(() => {})}
            >
              Open the cafe
            </button>
          )}
        </div>
      </header>

      <main style={{ '--panel-width': `${panel.width}px` } as React.CSSProperties}>
        {page === 'architecture' && <ArchitectureView />}
        {page === 'experiment' && models && suiteDraft && (
          <ExperimentPage
            models={models}
            draft={suiteDraft}
            onDraftChange={setSuiteDraft}
            onOpenRun={(id) => {
              void api
                .run(id)
                .then((run) => loadRun(run))
                .then(() => setPage('cafe'))
                .catch(() => {})
            }}
          />
        )}
        <section className="stage">
          <div className="canvas-wrap">
            <div className="scene-host" ref={mountRef} />
            {!runId && (
              <div className="stage-empty">
                <div className="stage-empty-card">
                  <h2>The cafe is closed</h2>
                  <p className="muted">
                    Nothing is playing yet. Start a shift with the current settings, or pick a
                    recent one in the Shift tab to replay it.
                  </p>
                  <button
                    type="button"
                    className="primary big"
                    disabled={!draft || draft.scenarioIds.length === 0}
                    onClick={() => void openCafe().catch(() => {})}
                  >
                    Open the cafe
                  </button>
                  {startError && <div className="error-box">{startError}</div>}
                </div>
              </div>
            )}
          </div>
          <PlaybackControls player={player} />
        </section>

        <aside className="panel">
          <button
            type="button"
            className="panel-resizer"
            aria-label="Resize panel"
            title="Drag to resize · double-click to reset · arrow keys nudge"
            onPointerDown={panel.startDrag}
            onDoubleClick={panel.reset}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') panel.nudge(20)
              else if (e.key === 'ArrowRight') panel.nudge(-20)
            }}
          />
          <nav className="tabs">
            {(
              [
                ['run', 'Shift'],
                ['visits', 'Visits'],
                ['queue', 'Queue'],
                ['inspector', 'Inspector'],
                ['metrics', 'Metrics'],
                ['log', 'Log'],
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
          <div className="panel-body">
            {bootError && <div className="error-box">{bootError}</div>}
            {tab === 'run' && models && draft && (
              <RunConfigPanel
                models={models}
                scenarios={scenarios}
                draft={draft}
                onDraftChange={setDraft}
                onStart={openCafe}
                onLoadRun={loadRun}
                currentRunId={runId}
                busy={isLive}
                startError={startError}
              />
            )}
            {tab === 'visits' && <TransactionList player={player} onSelect={onSelect} />}
            {tab === 'queue' && <QueuePanel player={player} />}
            {tab === 'inspector' && <AgentInspector player={player} selectedId={selectedId} />}
            {tab === 'metrics' && <MetricsDashboard runId={runId} status={runStatus} />}
            {tab === 'log' && <EventLog player={player} onPeek={onPeek} />}
          </div>
        </aside>
      </main>
    </div>
  )
}

/** Lantern-and-cup mark: warm glow against the dusk palette. */
function LanternMark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <defs>
        <radialGradient id="mk-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#ffd27a" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#ff9d3d" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ff9d3d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="22" r="22" fill="url(#mk-glow)" />
      <path
        d="M14 18h20v13a10 10 0 0 1-20 0z"
        fill="#f6efdd"
        stroke="#23485a"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M34 21h4a4 4 0 0 1 0 8h-4"
        fill="none"
        stroke="#23485a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M16 40h16" stroke="#23485a" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M20 14c0-3 3-3 3-6M27 14c0-3 3-3 3-6"
        fill="none"
        stroke="#ffd27a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <ellipse cx="24" cy="18" rx="10" ry="2.5" fill="#d28a5a" />
    </svg>
  )
}
