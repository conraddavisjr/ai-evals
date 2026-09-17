import Phaser from 'phaser'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { CafeScene, type SceneCallbacks } from './CafeScene.js'
import { configureScale, worldH, worldW } from './layout.js'

export function createGame(
  parent: HTMLElement,
  player: TimelinePlayer,
  callbacks: SceneCallbacks,
): Phaser.Game {
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
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  })
  game.scene.add('cafe', CafeScene, true, { player, callbacks })
  return game
}
