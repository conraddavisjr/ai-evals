import { type RefObject, useEffect, useState } from 'react'

/** Width of a container, live: charts render at the panel's width, whatever it is. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 320): number {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setW(Math.floor(width))
    })
    ro.observe(el)
    setW(Math.floor(el.getBoundingClientRect().width) || fallback)
    return () => ro.disconnect()
  }, [ref, fallback])
  return w
}
