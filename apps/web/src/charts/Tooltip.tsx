import { type ReactNode, useState } from 'react'

export interface TipState {
  x: number
  y: number
  content: ReactNode
}

/** One floating tooltip per chart, positioned inside the chart's own box. */
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const show = (
    e: { clientX: number; clientY: number; currentTarget: Element },
    content: ReactNode,
  ) => {
    const host = (e.currentTarget as Element).closest('.chart') ?? e.currentTarget
    const r = host.getBoundingClientRect()
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content })
  }
  const hide = () => setTip(null)
  return { tip, show, hide }
}

export function TooltipLayer({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null
  const flip = tip.x > width * 0.6
  return (
    <div
      className="chart-tip"
      style={{
        left: flip ? undefined : tip.x + 12,
        right: flip ? width - tip.x + 12 : undefined,
        top: Math.max(0, tip.y - 10),
      }}
    >
      {tip.content}
    </div>
  )
}
