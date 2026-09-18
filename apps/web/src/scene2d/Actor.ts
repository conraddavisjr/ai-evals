import type Phaser from 'phaser'
import { type Facing, pxX, pxY, route, S, type Spot, TILE } from './layout.js'

export type BubbleKind = 'speech' | 'thought' | 'tool' | 'shout'

const FONT = '"Pixelify Sans", monospace'
const WALK_MS_PER_TILE = 140

/**
 * One character on screen: sprite, name tag, bubble, progress ring, alert marker.
 * Knows how to walk a route and how to snap (for seeks). All positions in world px.
 */
export class Actor {
  readonly root: Phaser.GameObjects.Container
  readonly sprite: Phaser.GameObjects.Sprite
  private readonly nameTag: Phaser.GameObjects.Text
  private bubble: Phaser.GameObjects.Container | null = null
  private bubbleOffset = { x: 0, y: 0 }
  private bubbleExpires = 0
  private readonly ring: Phaser.GameObjects.Graphics
  private readonly ringLabel: Phaser.GameObjects.Text
  private alert: Phaser.GameObjects.Image | null = null
  private alertTween: Phaser.Tweens.Tween | null = null
  private walk: Phaser.Tweens.TweenChain | null = null
  tile: Spot
  facing: Facing = 'down'
  selected = false

  constructor(
    readonly scene: Phaser.Scene,
    readonly id: string,
    private readonly textureKey: string,
    readonly label: string,
    spot: Spot,
    private readonly onClick: (id: string) => void,
    /** Staff tags only show on hover/selection (they stand shoulder to shoulder); customers always. */
    private readonly alwaysShowName = true,
  ) {
    this.tile = { ...spot }
    this.sprite = scene.add.sprite(0, 0, textureKey, 'down_0').setOrigin(0.5, 1).setScale(S)
    this.nameTag = scene.add
      .text(0, 4, label, {
        fontFamily: FONT,
        fontSize: '11px',
        color: '#fffaf0',
        stroke: '#2b1d16',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
    this.ring = scene.add.graphics()
    this.ringLabel = scene.add
      .text(0, -(24 * S) - 22, '', {
        fontFamily: FONT,
        fontSize: '10px',
        color: '#fffaf0',
        stroke: '#2b1d16',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setVisible(false)
    this.root = scene.add.container(pxX(spot.x), pxY(spot.y), [
      this.sprite,
      this.nameTag,
      this.ring,
      this.ringLabel,
    ])
    this.root.setDepth(pxY(spot.y))
    this.sprite
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onClick(this.id))
      .on('pointerover', () => this.nameTag.setVisible(true))
      .on('pointerout', () => this.nameTag.setVisible(this.alwaysShowName || this.selected))
    this.nameTag.setVisible(alwaysShowName)
    this.face(spot.face)
  }

  // ---------- movement ----------

  face(dir: Facing) {
    this.facing = dir
    this.sprite.anims.stop()
    this.sprite.setFrame(`${dir}_0`)
  }

  snapTo(spot: Spot) {
    this.walk?.destroy()
    this.walk = null
    this.tile = { ...spot }
    this.root.setPosition(pxX(spot.x), pxY(spot.y))
    this.root.setDepth(pxY(spot.y))
    this.face(spot.face)
  }

  /** Walk via the aisle; speed multiplier shortens the trip in fast playback. */
  moveTo(spot: Spot, aisleRow: number, speed = 1): Promise<void> {
    this.walk?.destroy()
    const pts = route(this.tile, spot, aisleRow)
    const start = { x: this.root.x, y: this.root.y }
    const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = []
    let prev = start
    for (const p of pts) {
      const to = { x: pxX(p.x), y: pxY(p.y) }
      const tiles = (Math.abs(to.x - prev.x) + Math.abs(to.y - prev.y)) / (TILE * S)
      const dir: Facing =
        to.x !== prev.x ? (to.x > prev.x ? 'right' : 'left') : to.y > prev.y ? 'down' : 'up'
      const from = prev
      tweens.push({
        targets: this.root,
        x: to.x,
        y: to.y,
        duration: Math.max(60, (tiles * WALK_MS_PER_TILE) / speed),
        ease: 'Linear',
        onStart: () => {
          this.sprite.play(`${this.textureKey}:walk_${dir}`, true)
          this.facing = dir
        },
        onUpdate: () => this.root.setDepth(this.root.y),
        onComplete: () => {
          void from
        },
      })
      prev = to
    }
    this.tile = { ...spot }
    if (tweens.length === 0) {
      this.face(spot.face)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.walk = this.scene.tweens.chain({
        tweens,
        onComplete: () => {
          this.face(spot.face)
          this.root.setDepth(pxY(spot.y))
          resolve()
        },
      })
    })
  }

  // ---------- bubbles ----------

  say(text: string, kind: BubbleKind, ttlMs: number) {
    this.clearBubble()
    const maxW = 150
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: kind === 'tool' ? '"IBM Plex Mono", monospace' : FONT,
      fontSize: kind === 'tool' ? '10px' : '11px',
      color: kind === 'tool' ? '#2b3a67' : '#2b1d16',
      wordWrap: { width: maxW - 12 },
      align: 'left',
    }
    const label = this.scene.add.text(0, 0, text, style).setOrigin(0, 0)
    const w = Math.min(maxW, label.width + 12)
    const h = label.height + 10
    const g = this.scene.add.graphics()
    const fill = kind === 'tool' ? 0xe8eefc : kind === 'shout' ? 0xfff1c4 : 0xfffdf5
    const stroke = kind === 'tool' ? 0x4d7fc4 : kind === 'shout' ? 0xc9962a : 0x2b1d16
    g.fillStyle(fill, 1)
    g.lineStyle(2, stroke, 1)
    if (kind === 'thought' || kind === 'tool') {
      g.fillRoundedRect(0, 0, w, h, 8)
      g.strokeRoundedRect(0, 0, w, h, 8)
      g.fillCircle(10, h + 5, 3)
      g.strokeCircle(10, h + 5, 3)
      g.fillCircle(5, h + 11, 2)
      g.strokeCircle(5, h + 11, 2)
    } else {
      g.fillRoundedRect(0, 0, w, h, 4)
      g.strokeRoundedRect(0, 0, w, h, 4)
      g.fillTriangle(10, h - 1, 18, h - 1, 12, h + 7)
      g.lineStyle(2, stroke, 1)
      g.lineBetween(10, h, 12, h + 7)
      g.lineBetween(18, h, 12, h + 7)
    }
    label.setPosition(6, 5)
    // Bubbles live on their own layer above every actor so a character in front never hides them.
    const c = this.scene.add.container(0, 0, [g, label]).setDepth(2000)
    // Neighbours behind the counter stand one tile apart; stagger odd columns so two
    // simultaneous bubbles do not sit on top of each other.
    const headY = -(24 * S) - 14 - (this.tile.x % 2 === 1 ? 26 : 0)
    let bx = -w / 2
    const worldX = this.root.x + bx
    if (worldX < 4) bx += 4 - worldX
    const overflow = this.root.x + bx + w - (this.scene.scale.width - 4)
    if (overflow > 0) bx -= overflow
    this.bubbleOffset = { x: bx, y: headY - h - 8 }
    c.setPosition(this.root.x + bx, this.root.y + this.bubbleOffset.y)
    this.bubble = c
    this.bubbleExpires = this.scene.time.now + ttlMs
  }

  clearBubble() {
    this.bubble?.destroy()
    this.bubble = null
  }

  // ---------- ring & alert ----------

  /** ratio = elapsed / expected. >1 amber, >2 red. */
  drawRing(ratio: number | null, labelText: string) {
    this.ring.clear()
    if (ratio === null) {
      this.ringLabel.setVisible(false)
      return
    }
    const r = 9
    const cx = 0
    const cy = -(24 * S) - 12
    const color = ratio > 2 ? 0xd9412f : ratio > 1 ? 0xe6a23c : 0x5e9b45
    this.ring.lineStyle(3, 0x2b1d16, 0.9)
    this.ring.strokeCircle(cx, cy, r + 1.5)
    this.ring.lineStyle(3, 0xfffdf5, 0.9)
    this.ring.strokeCircle(cx, cy, r)
    this.ring.lineStyle(3, color, 1)
    const frac = Math.min(
      1,
      ratio % 1 === 0 && ratio > 0 ? 1 : ratio > 1 ? ratio - Math.floor(ratio) : ratio,
    )
    const start = -Math.PI / 2
    this.ring.beginPath()
    this.ring.arc(cx, cy, r, start, start + Math.PI * 2 * (ratio >= 1 ? 1 : frac), false)
    this.ring.strokePath()
    if (ratio > 1) {
      // second lap shows the overshoot
      this.ring.lineStyle(3, color, 1)
      this.ring.beginPath()
      this.ring.arc(cx, cy, r + 4, start, start + Math.PI * 2 * Math.min(1, ratio - 1), false)
      this.ring.strokePath()
    }
    this.ringLabel
      .setText(labelText)
      .setVisible(true)
      .setColor(ratio > 2 ? '#ffb3a7' : ratio > 1 ? '#ffe0a3' : '#fffaf0')
  }

  showAlert() {
    if (this.alert) return
    this.alert = this.scene.add
      .image(12, -(24 * S) - 30, 'tile:alert')
      .setScale(S)
      .setOrigin(0.5, 1)
    this.alert
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onClick(this.id))
    this.root.add(this.alert)
    this.alertTween = this.scene.tweens.add({
      targets: this.alert,
      y: this.alert.y - 6,
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  clearAlert() {
    this.alertTween?.destroy()
    this.alert?.destroy()
    this.alert = null
    this.alertTween = null
  }

  setSelected(on: boolean) {
    this.selected = on
    this.sprite.setTint(on ? 0xfff2b0 : 0xffffff)
    this.nameTag.setVisible(this.alwaysShowName || on)
  }

  update(now: number) {
    if (this.bubble && now > this.bubbleExpires) this.clearBubble()
    if (this.bubble)
      this.bubble.setPosition(this.root.x + this.bubbleOffset.x, this.root.y + this.bubbleOffset.y)
  }

  destroy() {
    this.walk?.destroy()
    this.alertTween?.destroy()
    this.clearBubble()
    this.root.destroy(true)
  }
}
