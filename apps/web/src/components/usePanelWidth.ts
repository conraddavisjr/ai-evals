import { useCallback, useEffect, useState } from 'react'

const KEY = 'cafe.panelWidth'
export const PANEL_DEFAULT = 360
export const PANEL_MIN = 300
/** The side panel never takes more than this share of the viewport. */
export const PANEL_MAX_FRACTION = 0.5

export function clampPanelWidth(px: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN, Math.floor(viewportWidth * PANEL_MAX_FRACTION))
  return Math.min(max, Math.max(PANEL_MIN, Math.round(px)))
}

/**
 * Width of the side panel in px, persisted, clamped to the viewport on resize.
 * `startDrag` is the pointerdown handler for the resize handle on the panel's left edge.
 */
export function usePanelWidth() {
  const [width, setWidth] = useState(() => {
    let stored = PANEL_DEFAULT
    try {
      stored = Number(localStorage.getItem(KEY)) || PANEL_DEFAULT
    } catch {
      /* private mode */
    }
    return clampPanelWidth(stored, window.innerWidth)
  })

  const commit = useCallback((px: number) => {
    const next = clampPanelWidth(px, window.innerWidth)
    setWidth(next)
    try {
      localStorage.setItem(KEY, String(next))
    } catch {
      /* private mode */
    }
  }, [])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampPanelWidth(w, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startW = width
      document.body.classList.add('resizing-panel')
      const onMove = (ev: PointerEvent) => {
        // the panel is on the right, so dragging left makes it wider
        setWidth(clampPanelWidth(startW + (startX - ev.clientX), window.innerWidth))
      }
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('resizing-panel')
        commit(startW + (startX - ev.clientX))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [width, commit],
  )

  const reset = useCallback(() => commit(PANEL_DEFAULT), [commit])
  const nudge = useCallback((delta: number) => commit(width + delta), [commit, width])

  return { width, startDrag, reset, nudge }
}
