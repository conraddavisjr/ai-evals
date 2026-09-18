import type { SceneView } from './types.js'

export type { SceneCallbacks, SceneHandle, SceneView } from './types.js'

/** Every registered way of drawing the cafe, in switcher order. Add a view here to make it available. */
export const SCENE_VIEWS: readonly SceneView[] = [
  {
    id: 'painterly',
    label: 'Village',
    blurb: 'Painterly top-down 3D village square. Drag to orbit, scroll to zoom.',
    mount: async (parent, player, callbacks) =>
      (await import('../scene3d/game.js')).createGame(parent, player, callbacks),
  },
  {
    id: 'pixel',
    label: 'Pixel',
    blurb: 'The original Stardew-style pixel cafe, drawn in Phaser.',
    mount: async (parent, player, callbacks) =>
      (await import('../scene2d/game.js')).createGame(parent, player, callbacks),
  },
]

export const DEFAULT_VIEW_ID = SCENE_VIEWS[0]?.id ?? 'painterly'

export function findView(id: string | null | undefined): SceneView {
  return SCENE_VIEWS.find((v) => v.id === id) ?? (SCENE_VIEWS[0] as SceneView)
}
