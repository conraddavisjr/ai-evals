import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export interface DrawerContent {
  title: string
  subtitle?: string | undefined
  body: ReactNode
}

interface DrawerApi {
  open(content: DrawerContent): void
  close(): void
  current: DrawerContent | null
}

const DrawerContext = createContext<DrawerApi | null>(null)

/**
 * One drill-down drawer for the whole app: an additional panel with more context
 * on whatever was just clicked (a slow tool call, a judge score, a visit). It
 * never covers the side panel: the host renders <DrawerOutlet /> as its own
 * column beside the side panel, so the list you clicked in keeps its scroll
 * position. Panels open it through useDrawer(); Escape or close dismisses it.
 */
export function DrawerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DrawerContent | null>(null)
  const open = useCallback((c: DrawerContent) => setCurrent(c), [])
  const close = useCallback(() => setCurrent(null), [])
  const api = useMemo(() => ({ open, close, current }), [open, close, current])
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close])
  return <DrawerContext.Provider value={api}>{children}</DrawerContext.Provider>
}

/** Where the drawer renders: a column of its own next to the side panel, or nothing. */
export function DrawerOutlet() {
  const { current, close } = useDrawer()
  if (!current) return null
  return (
    <aside className="drawer" aria-label={current.title}>
      <header className="drawer-head">
        <div>
          <h3>{current.title}</h3>
          {current.subtitle && <div className="muted small">{current.subtitle}</div>}
        </div>
        <button type="button" className="link" onClick={close} title="Close (Esc)">
          close ×
        </button>
      </header>
      <div className="drawer-body">{current.body}</div>
    </aside>
  )
}

export function useDrawer(): DrawerApi {
  const api = useContext(DrawerContext)
  if (!api) throw new Error('useDrawer must be used inside <DrawerProvider>')
  return api
}
