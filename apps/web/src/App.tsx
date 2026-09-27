import type { Scenario } from '@cafe/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchitectureView } from './architecture/ArchitectureView.js'
import { BenchPage } from './bench/BenchPage.js'
import { AgentInspector } from './components/AgentInspector.js'
import { DrawerOutlet, useDrawer } from './components/Drawer.js'
import { EventLog } from './components/EventLog.js'
import { InspectorTrail } from './components/InspectorTrail.js'
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
import {
  type DomainInfo,
  type ModelsInfo,
  type RunRow,
  useExperimentApi,
  useHarness,
} from './harness/index.js'
import { outcomeLabel, roleCount, sentence, setActiveDomain, words } from './lib/nomenclature.js'
import { TimelinePlayer } from './playback/TimelinePlayer.js'
import { usePlayer } from './playback/usePlayer.js'
import { ProjectsPage } from './projects/ProjectsPage.js'
import { applyTheme, readTheme, THEMES, type ThemeId } from './themes/theme.js'
import { DEFAULT_VIEW_ID, findView, SCENE_VIEWS, type SceneHandle } from './views/index.js'

type Tab = 'run' | 'inspector' | 'queue' | 'cases' | 'metrics' | 'log'
const APP_NAME = 'Evals Cafe'
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
  const [domains, setDomains] = useState<DomainInfo[]>([])
  const [draft, setDraft] = useState<RunDraft | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string>('idle')
  const [isLive, setIsLive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('run')
  const [page, setPage] = useState<'cafe' | 'experiment' | 'bench' | 'architecture' | 'projects'>(
    'cafe',
  )
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
  const [theme, setTheme] = useState<ThemeId>(readTheme)
  const closeStream = useRef<(() => void) | null>(null)

  /** Details opened from the Cases list, oldest first: the last one shows in the panel, the list moves left. */
  const [caseStack, setCaseStack] = useState<string[]>([])
  /** Views opened from inside the Inspector (a tool from a case, an agent from a tool), for "back". */
  const [inspectorBack, setInspectorBack] = useState<string[]>([])
  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    setInspectorBack([])
    if (id) setTab('inspector')
  }, [])
  const inspectorOpen = useCallback(
    (id: string) => {
      if (selectedId) setInspectorBack((b) => [...b, selectedId])
      setSelectedId(id)
    },
    [selectedId],
  )
  /** A trail column becomes the current view again: everything after it closes. */
  const inspectorFocus = useCallback(
    (i: number) => {
      const id = inspectorBack[i]
      if (id === undefined) return
      setInspectorBack(inspectorBack.slice(0, i))
      setSelectedId(id)
    },
    [inspectorBack],
  )
  /** A link clicked in a trail column: the path continues from that column. */
  const inspectorOpenFrom = useCallback(
    (i: number, id: string) => {
      setInspectorBack(inspectorBack.slice(0, i + 1))
      setSelectedId(id)
    },
    [inspectorBack],
  )
  const inspectorBackTo = useCallback(() => {
    setInspectorBack((b) => {
      setSelectedId(b.at(-1) ?? null)
      return b.slice(0, -1)
    })
  }, [])
  /** Select without leaving the current tab (the Log's nested pane). */
  const onPeek = useCallback((id: string | null) => setSelectedId(id), [])
  const panel = usePanelWidth()
  const drawer = useDrawer()

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
    api
      .domains?.()
      .then(setDomains)
      .catch(() => setDomains([]))
  }, [api, experiment])

  /** Switch the draft to another business: its golden cases, and its mocks for any role still on a mock. */
  const changeDomain = useCallback(
    async (id: string) => {
      const d = domains.find((x) => x.id === id)
      if (!d || !draft) return
      const list = await api.scenarios(id)
      setScenarios(list)
      const roles = { ...draft.roles }
      for (const role of ['cashier', 'barista', 'manager', 'judge'] as const)
        if (roles[role].startsWith('mock:')) roles[role] = d.defaultRoles[role]
      setDraft({ ...draft, domain: id, roles, scenarioIds: list.map((s) => s.id) })
    },
    [api, domains, draft],
  )

  // Every label follows the loaded run's domain, else the one being drafted.
  const domainId =
    page === 'experiment'
      ? (suiteDraft?.domain ?? 'cafe')
      : (player.state.config?.domain ?? draft?.domain ?? 'cafe')
  setActiveDomain(domainId, page === 'experiment' ? null : player.state.config?.target?.vocabulary)
  const vocab = words()
  // The Village and Pixel scenes draw the cafe; any other business plays on the Trace board.
  const shownSceneId = !vocab.hasScene && findView(sceneId).cafeArt ? 'trace' : sceneId

  // Mount the chosen view; switching tears the old one down and the new one snaps to player.state.
  useEffect(() => {
    const parent = mountRef.current
    if (!parent) return
    const view = findView(shownSceneId)
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
  }, [onSelect, shownSceneId])

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

  /** Start the drafted run. The one entry point behind every "Start run" button. */
  const openCafe = useCallback(async () => {
    if (!draft) return
    setStartError(null)
    try {
      const { runId: id } = await api.startRun(toRunConfig(draft))
      player.reset()
      player.setMode('live-buffered')
      player.play()
      attach(id, true)
      setTab('cases')
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
      // Views build labels as events arrive: the run's own words must be active first.
      setActiveDomain(run.config.domain, run.config.target?.vocabulary)
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
      setTab('cases')
      // A shareable link to what is on screen: the CLI prints the same form.
      const url = new URL(window.location.href)
      url.searchParams.set('run', run.id)
      window.history.replaceState(null, '', url)
    },
    [api, attach],
  )

  // ?run=<id> opens that run: the link the target CLI prints ("watch it live") and CI posts.
  const linkedRun = useRef(new URL(window.location.href).searchParams.get('run'))
  useEffect(() => {
    const id = linkedRun.current
    if (!id) return
    linkedRun.current = null
    api
      .run(id)
      .then((run) => loadRun(run))
      .catch(() => {})
  }, [api, loadRun])

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
      else if (e.code === 'End') {
        e.preventDefault()
        player.skipToEnd()
      } else if (e.key === '1') player.setMode('live-buffered')
      else if (e.key === '2') player.setMode('live-raw')
      else if (e.key === '3') player.setMode('replay')
      else if (e.key === '4') player.setMode('step')
      else if (e.key === '5') player.setMode('directors-cut')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const state = player.state
  const casesDetail = page === 'cafe' && tab === 'cases' && caseStack.length > 0
  const showTrail =
    (page === 'cafe' && tab === 'inspector' && inspectorBack.length > 0) || casesDetail
  const agentsList = Object.values(state.agents)
  const staffSummary = `${roleCount('cashier', agentsList.filter((x) => x.role === 'cashier').length)} · ${roleCount('barista', agentsList.filter((x) => x.role === 'barista').length)}`

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
                Run view
              </button>
              <button
                type="button"
                className={page === 'projects' ? 'on' : ''}
                onClick={() => {
                  setPage('projects')
                  setMenuOpen(false)
                }}
              >
                Projects
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
                className={page === 'bench' ? 'on' : ''}
                onClick={() => {
                  setPage('bench')
                  setMenuOpen(false)
                }}
              >
                Decision bench
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
              <fieldset className="menu-section">
                <legend className="menu-heading">Settings · Theme</legend>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={theme === t.id}
                    className={`menu-theme ${theme === t.id ? 'on' : ''}`}
                    title={t.blurb}
                    onClick={() => {
                      applyTheme(t.id)
                      setTheme(t.id)
                    }}
                  >
                    <span className="menu-radio" aria-hidden="true">
                      {theme === t.id ? '●' : '○'}
                    </span>{' '}
                    {t.label}
                    <span className="menu-sub">{t.blurb}</span>
                  </button>
                ))}
              </fieldset>
            </nav>
          )}
        </div>
        <div className="brand">
          <LanternMark />
          <div className="brand-text">
            <span className="title">{APP_NAME}</span>
            <span className="subtitle">
              {/* the cafe domain is the app's namesake: say it once */}
              agentic eval{vocab.business === APP_NAME ? '' : ` · ${vocab.business}`}
            </span>
          </div>
        </div>
        <div className="segmented view-switch" role="tablist" aria-label="Scene style">
          {SCENE_VIEWS.map((v) => {
            const unavailable = !vocab.hasScene && v.cafeArt
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={shownSceneId === v.id}
                className={shownSceneId === v.id ? 'on' : ''}
                disabled={unavailable}
                title={
                  unavailable
                    ? `${v.label} draws the cafe; ${vocab.business} plays on the Trace board.`
                    : v.blurb
                }
                onClick={() => chooseScene(v.id)}
              >
                {v.label}
              </button>
            )
          })}
        </div>
        <div className="status">
          {runId ? (
            <>
              <span className={`pill ${runStatus}`}>{sentence(runStatus)}</span>
              <span className="muted mono runid">{runId.slice(-8)}</span>
              <span className="muted staff">{staffSummary}</span>
              <span className="muted">
                {Object.values(state.customers).filter((c) => c.outcome === 'served').length}{' '}
                {outcomeLabel('served')}
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
            <span className="muted">no run loaded</span>
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
                    ? 'Pick at least one golden case in the Run tab'
                    : 'Start a run with the settings in the Run tab'
              }
              onClick={() => void openCafe().catch(() => {})}
            >
              Start run
            </button>
          )}
        </div>
      </header>

      <main
        className={[drawer.current ? 'with-drawer' : '', showTrail ? 'with-trail' : ''].join(' ')}
        style={{ '--panel-width': `${panel.width}px` } as React.CSSProperties}
      >
        {page === 'architecture' && <ArchitectureView />}
        {page === 'projects' && (
          <ProjectsPage
            onOpenRun={(run) => {
              void loadRun(run)
                .then(() => setPage('cafe'))
                .catch(() => {})
            }}
          />
        )}
        {page === 'bench' && models && <BenchPage models={models} domains={domains} />}
        {page === 'experiment' && models && suiteDraft && (
          <ExperimentPage
            models={models}
            domains={domains}
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
          </div>
          <PlaybackControls player={player} />
        </section>

        <DrawerOutlet />
        {showTrail && !casesDetail && (
          <InspectorTrail
            ids={inspectorBack}
            player={player}
            onFocus={inspectorFocus}
            onOpenFrom={inspectorOpenFrom}
            panelWidth={panel.width}
          />
        )}
        {casesDetail && (
          <InspectorTrail
            ids={caseStack.slice(0, -1)}
            player={player}
            onFocus={(i) => setCaseStack((s) => s.slice(0, i + 1))}
            onOpenFrom={(i, id) => setCaseStack((s) => [...s.slice(0, i + 1), id])}
            panelWidth={panel.width}
            leading={{
              title: 'Cases',
              onClose: () => setCaseStack([]),
              body: (
                <TransactionList
                  player={player}
                  onOpen={(id) => setCaseStack([id])}
                  openId={caseStack[0]}
                />
              ),
            }}
          />
        )}
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
                ['run', 'Run'],
                ['cases', 'Cases'],
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
                domains={domains}
                onDomainChange={(id) => void changeDomain(id).catch(() => {})}
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
            {tab === 'cases' &&
              (caseStack.length === 0 ? (
                <TransactionList player={player} onOpen={(id) => setCaseStack([id])} />
              ) : (
                <AgentInspector
                  player={player}
                  selectedId={caseStack.at(-1) ?? null}
                  onSelect={(id) => setCaseStack((s) => [...s, id])}
                  onBack={() => setCaseStack((s) => s.slice(0, -1))}
                />
              ))}
            {tab === 'queue' && <QueuePanel player={player} />}
            {tab === 'inspector' && (
              <AgentInspector
                player={player}
                selectedId={selectedId}
                onSelect={inspectorOpen}
                onBack={inspectorBack.length ? inspectorBackTo : undefined}
              />
            )}
            {tab === 'metrics' && (
              <MetricsDashboard runId={runId} status={runStatus} player={player} />
            )}
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
