import type { RunConfigInput, Scenario } from '@cafe/protocol'
import type Phaser from 'phaser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ModelsInfo, openStream, type RunRow } from './api.js'
import { AgentInspector } from './components/AgentInspector.js'
import { EventLog } from './components/EventLog.js'
import { MetricsDashboard } from './components/MetricsDashboard.js'
import { PlaybackControls } from './components/PlaybackControls.js'
import { QueuePanel } from './components/QueuePanel.js'
import { RunConfigPanel } from './components/RunConfigPanel.js'
import { TransactionList } from './components/TransactionList.js'
import { fmtUsd } from './format.js'
import { TimelinePlayer } from './playback/TimelinePlayer.js'
import { usePlayer } from './playback/usePlayer.js'
import { createGame } from './scene/game.js'

type Tab = 'run' | 'inspector' | 'queue' | 'visits' | 'metrics' | 'log'

const player = new TimelinePlayer()

export function App() {
  usePlayer(player)
  const mountRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const [models, setModels] = useState<ModelsInfo | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string>('idle')
  const [isLive, setIsLive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('run')
  const closeStream = useRef<(() => void) | null>(null)

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) setTab('inspector')
  }, [])

  useEffect(() => {
    Promise.all([api.models(), api.scenarios()])
      .then(([m, s]) => {
        setModels(m)
        setScenarios(s)
      })
      .catch((e) =>
        setBootError(
          `Cannot reach the server: ${e instanceof Error ? e.message : e}. Is \`pnpm dev\` running?`,
        ),
      )
  }, [])

  useEffect(() => {
    if (!mountRef.current || gameRef.current) return
    gameRef.current = createGame(mountRef.current, player, { onSelect })
    if (import.meta.env.DEV)
      (window as unknown as { __cafe: unknown }).__cafe = { player, game: gameRef.current }
    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
    }
  }, [onSelect])

  const attach = useCallback((id: string, live: boolean, afterSeq = -1) => {
    closeStream.current?.()
    closeStream.current = null
    setRunId(id)
    setIsLive(live)
    setSelectedId(null)
    if (live) {
      setRunStatus('running')
      closeStream.current = openStream(
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
  }, [])

  const startRun = useCallback(
    async (config: RunConfigInput) => {
      const { runId: id } = await api.startRun(config)
      player.reset()
      player.setMode('live-buffered')
      player.play()
      attach(id, true)
      setTab('visits')
    },
    [attach],
  )

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
    [attach],
  )

  const cancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId)
  }, [runId])

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
        <div className="brand">
          <span className="logo">☕</span> Stardust Cafe{' '}
          <span className="muted">agentic eval harness</span>
        </div>
        <div className="status">
          {runId ? (
            <>
              <span className={`pill ${runStatus}`}>{runStatus}</span>
              <span className="muted mono">{runId.slice(-8)}</span>
              <span className="muted">{staffSummary}</span>
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
        </div>
      </header>

      <main>
        <section className="stage">
          <div className="canvas-wrap" ref={mountRef} />
          <PlaybackControls player={player} isLiveRun={isLive} />
        </section>

        <aside className="panel">
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
            {tab === 'run' && models && (
              <RunConfigPanel
                models={models}
                scenarios={scenarios}
                onStart={startRun}
                onLoadRun={loadRun}
                currentRunId={runId}
                busy={isLive}
              />
            )}
            {tab === 'visits' && <TransactionList player={player} onSelect={onSelect} />}
            {tab === 'queue' && <QueuePanel player={player} />}
            {tab === 'inspector' && <AgentInspector player={player} selectedId={selectedId} />}
            {tab === 'metrics' && <MetricsDashboard runId={runId} status={runStatus} />}
            {tab === 'log' && <EventLog player={player} onSelect={onSelect} />}
          </div>
        </aside>
      </main>
    </div>
  )
}
