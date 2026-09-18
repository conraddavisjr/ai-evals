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
}
export interface ArchHandle {
  fit(): void
  expand(id: string | null): void
  destroy(): void
}
export function mountArchitecture(container: HTMLElement, options: ArchOptions): ArchHandle
