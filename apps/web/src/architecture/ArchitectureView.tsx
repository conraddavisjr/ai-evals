import { ARCH } from '@arch/data.js'
import { mountArchitecture } from '@arch/engine.js'
import { useEffect, useRef } from 'react'
import '@arch/base.css'
import './architecture.css'

const LEGEND: Array<[string, string]> = [
  ['sky', 'Client'],
  ['teal', 'API server'],
  ['moss', 'Orchestration'],
  ['gold', 'Agent runtime'],
  ['copper', 'MCP gateway'],
  ['lavender', 'Models'],
  ['rose', 'Evals'],
  ['stone', 'Data'],
  ['ink', 'Protocol'],
  ['slate', 'External'],
]

/**
 * The architecture map, mounted from the same data and engine as the standalone
 * pages in docs/architecture. Keep docs/architecture/data.js current when the
 * system changes; this view and the published diagrams update together.
 */
export function ArchitectureView() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const zoomInRef = useRef<HTMLButtonElement>(null)
  const zoomOutRef = useRef<HTMLButtonElement>(null)
  const fitRef = useRef<HTMLButtonElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDataListElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const handle = mountArchitecture(canvasRef.current, {
      data: ARCH,
      nicknames: false,
      controls: {
        zoomIn: zoomInRef.current,
        zoomOut: zoomOutRef.current,
        fit: fitRef.current,
        zoom: zoomRef.current,
        status: statusRef.current,
        search: searchRef.current,
        searchList: listRef.current,
      },
    })
    return () => handle.destroy()
  }, [])

  return (
    <div className="archv archv-app">
      <div className="bar">
        <h2 className="title">Architecture</h2>
        <span className="sub">Drag to pan · scroll to zoom · click a component for details</span>
        <span className="spacer" />
        <input
          id="arch-search"
          ref={searchRef}
          list="arch-search-list"
          placeholder="Jump to a component…"
          aria-label="Jump to a component"
        />
        <datalist id="arch-search-list" ref={listRef} />
        <button type="button" ref={zoomOutRef} aria-label="Zoom out">
          −
        </button>
        <span className="zoom" ref={zoomRef}>
          100%
        </span>
        <button type="button" ref={zoomInRef} aria-label="Zoom in">
          +
        </button>
        <button type="button" ref={fitRef}>
          Fit
        </button>
        <span className="status" ref={statusRef}>
          Click any component to expand it. Esc collapses.
        </span>
      </div>
      <div className="legend">
        {LEGEND.map(([tone, name]) => (
          <span key={tone} className={`tone-${tone}`}>
            <i /> {name}
          </span>
        ))}
      </div>
      <div ref={canvasRef} />
    </div>
  )
}
