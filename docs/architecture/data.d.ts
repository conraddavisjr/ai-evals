export interface ArchSegment {
  id: string
  title: string
  sub: string
  nick: string
  x: number
  y: number
  w: number
  h: number
  tone: string
}
export interface ArchNode {
  id: string
  seg: string
  x: number
  y: number
  w?: number
  h?: number
  title: string
  nick?: string
  summary: string
  details?: string[]
  files?: string[]
}
export interface ArchEdge {
  from: string
  to: string
  label?: string
}
export interface ArchData {
  world: { w: number; h: number }
  segments: ArchSegment[]
  nodes: ArchNode[]
  edges: ArchEdge[]
}
export const ARCH: ArchData
