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
  domain,
}: {
  /** The suite's business domain; the diagram's words follow it, so a change remounts it. */
  domain: string
  selected: PipelineNodeId | null
  onSelect: (id: PipelineNodeId | null) => void
  summaries: Partial<Record<PipelineNodeId, string>>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handle = useRef<ArchHandle | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // biome-ignore lint/correctness/useExhaustiveDependencies: pipelineData() reads the active domain's words
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
  }, [domain])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a remount (new domain) needs the summaries again
  useEffect(() => {
    for (const [id, text] of Object.entries(summaries))
      if (text) handle.current?.setSummary(id, text)
  }, [summaries, domain])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a remount (new domain) needs the selection again
  useEffect(() => {
    handle.current?.select(selected)
  }, [selected, domain])

  return (
    <div className="pipeline archv archv-app">
      <div ref={ref} />
    </div>
  )
}
