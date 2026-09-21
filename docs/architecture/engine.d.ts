import type { ArchData } from './data.js'

export interface ArchControls {
  zoomIn?: HTMLElement | null
  zoomOut?: HTMLElement | null
  fit?: HTMLElement | null
  zoom?: HTMLElement | null
  status?: HTMLElement | null
  search?: HTMLInputElement | null
  searchList?: HTMLElement | null
}
export interface ArchOptions {
  data: ArchData
  nicknames?: boolean
  controls?: ArchControls
  /** Fires whenever the selected node changes. */
  onSelect?: (id: string | null) => void
  /** false: a click selects (highlights edges, dims the rest) without widening the card. Default true. */
  expandOnClick?: boolean
  initialSelected?: string
  /** Replaces the card hint text. */
  hint?: string
}
export interface ArchHandle {
  fit(): void
  expand(id: string | null): void
  /** Alias of expand; reads better when expandOnClick is false. */
  select(id: string | null): void
  /** Replace a node's summary line in place. */
  setSummary(id: string, text: string): void
  destroy(): void
}
export function mountArchitecture(container: HTMLElement, options: ArchOptions): ArchHandle
