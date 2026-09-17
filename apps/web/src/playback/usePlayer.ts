import { useEffect, useState, useSyncExternalStore } from 'react'
import type { TimelinePlayer } from './TimelinePlayer.js'

let version = 0

/** React view of the player: re-renders on any change, throttled to animation frames. */
export function usePlayer(player: TimelinePlayer) {
  const subscribe = (cb: () => void) => {
    // Coalesce bursts of changes into one render per ~frame. A timer (not rAF) so the
    // panels keep updating when the tab is hidden and Chrome suspends animation frames.
    let pending: ReturnType<typeof setTimeout> | null = null
    const off = player.subscribe({
      onChange: () => {
        version += 1
        if (pending === null) {
          pending = setTimeout(() => {
            pending = null
            cb()
          }, 16)
        }
      },
    })
    return () => {
      off()
      if (pending !== null) clearTimeout(pending)
    }
  }
  useSyncExternalStore(subscribe, () => version)
  return player
}

/** A ticking clock (for "elapsed" readouts) at ~10Hz. */
export function useClock(intervalMs = 100): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
