import Phaser from 'phaser'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { SceneCallbacks, SceneHandle } from '../views/types.js'
import { CafeScene } from './CafeScene.js'
import { configureScale, worldH, worldW } from './layout.js'

/**
 * The pixel cafe. The world is drawn at an integer scale that fits the mount at
 * creation, then letterboxed by Phaser's FIT scaler so it follows later resizes.
 */
export function createGame(
  parent: HTMLElement,
  player: TimelinePlayer,
  callbacks: SceneCallbacks,
): SceneHandle {
  parent.classList.add('pixel-mount')
  const rect = parent.getBoundingClientRect()
  configureScale(Math.max(320, rect.width - 16), Math.max(208, rect.height - 16))
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: worldW(),
    height: worldH(),
    backgroundColor: '#1b120c',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  })
  game.scene.add('cafe', CafeScene, true, { player, callbacks })
  const ro = new ResizeObserver(() => game.scale.refresh())
  ro.observe(parent)
  return {
    step(now: number) {
      // Phaser drives its own loop; a manual step just keeps the player current.
      player.tick(now)
    },
    destroy() {
      ro.disconnect()
      game.destroy(true)
      parent.classList.remove('pixel-mount')
    },
  }
}
