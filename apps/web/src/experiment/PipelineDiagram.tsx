import type { ArchHandle } from '@arch/engine.js'
import { mountArchitecture } from '@arch/engine.js'
import { useEffect, useRef } from 'react'
import { type PipelineNodeId, pipelineData } from './pipeline-data.js'
import '@arch/base.css'

/**
 * The clickable pipeline. Mounts the architecture engine in select mode: a click
 * highlights the node and its edges and tells the page, which renders that layer's
 * controls beside the diagram. Summaries are patched in place as the config changes.
 */
export function PipelineDiagram({
  selected,
  onSelect,
  summaries,
}: {
  selected: PipelineNodeId | null
  onSelect: (id: PipelineNodeId | null) => void
  summaries: Partial<Record<PipelineNodeId, string>>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handle = useRef<ArchHandle | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!ref.current) return
    const h = mountArchitecture(ref.current, {
      data: pipelineData(),
      expandOnClick: false,
      hint: 'click to configure',
      onSelect: (id) => onSelectRef.current(id as PipelineNodeId | null),
    })
    handle.current = h
    return () => {
      h.destroy()
      handle.current = null
    }
  }, [])

  useEffect(() => {
    for (const [id, text] of Object.entries(summaries))
      if (text) handle.current?.setSummary(id, text)
  }, [summaries])

  useEffect(() => {
    handle.current?.select(selected)
  }, [selected])

  return (
    <div className="pipeline archv archv-app">
      <div ref={ref} />
    </div>
  )
}
