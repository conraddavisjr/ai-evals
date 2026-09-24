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
 * One drill-down drawer for the whole app: a subpanel that slides in from the
 * right with more context on whatever was just clicked (a slow tool call, a judge
 * score, a visit). Panels open it through useDrawer(); Escape or the close button
 * dismisses it.
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
  return (
    <DrawerContext.Provider value={api}>
      {children}
      {current && (
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
      )}
    </DrawerContext.Provider>
  )
}

export function useDrawer(): DrawerApi {
  const api = useContext(DrawerContext)
  if (!api) throw new Error('useDrawer must be used inside <DrawerProvider>')
  return api
}
