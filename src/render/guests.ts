import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RECIPES } from '../data/index.ts'
import { NPCS } from '../systems/orders.ts'
import { dailySpecial, guestMood, guestSeat } from '../systems/restaurant.ts'
import { createCharacter } from './character.ts'
import type { Farmer } from './models.ts'

export interface GuestsView {
  update(state: GameState, time: number, nowMs: number): void
  /** Mã khách ở điểm chạm (trong nhà), hoặc null. */
  hitTest(camera: THREE.Camera, x: number, y: number): number | null
}

interface Rig {
  farmer: Farmer
  bubble: THREE.Sprite
  key: string
}

/** Chỗ ngồi hơi thấp hơn sàn đứng để khách "lún" vào ghế. */
const SIT_Y = 0.16
const BUBBLE_Y = 1.95

/** Khách của nhà hàng: ngồi ở ghế, bong bóng món đang chờ trên đầu. */
export function createGuestsView(scene: THREE.Scene): GuestsView {
  const rigs = new Map<number, Rig>()
  const v = new THREE.Vector3()

  return {
    update(state, time, nowMs) {
      const live = new Set<number>()
      for (const g of state.restaurant.guests) {
        // Ghế trong nhà (tầng >= 0) chỉ hiện khi đang ở trong nhà đúng tầng; ghế ngoài sân nhà hàng (-1) hiện khi ở ngoài.
        const here = g.fl < 0 ? !state.player.indoors : state.player.indoors && g.fl === state.player.floor
        const seat = here ? guestSeat(state, g) : undefined
        if (!seat) continue
        live.add(g.id)
        let rig = rigs.get(g.id)
        if (!rig) {
          const farmer = createCharacter(NPCS[g.look % NPCS.length].look)
          const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
          bubble.scale.set(1, 1, 1)
          bubble.position.y = BUBBLE_Y
          farmer.root.add(bubble)
          scene.add(farmer.root)
          rig = { farmer, bubble, key: '' }
          rigs.set(g.id, rig)
        }
        rig.farmer.root.position.set(seat.x, SIT_Y, seat.z)
        rig.farmer.root.rotation.y = seat.rotY
        rig.farmer.animate(0, 0)
        const icons = g.foods.map((f) => RECIPES.find((r) => r.id === f)?.icon ?? '🍽️')
        const key = `${icons.join('')}|${guestMood(g, nowMs)}|${g.kind}|${g.special && g.foods[0] === dailySpecial(state) ? 1 : 0}`
        if (rig.key !== key) {
          rig.key = key
          const m = rig.bubble.material as THREE.SpriteMaterial
          m.map = bubbleTexture(key, icons, guestMood(g, nowMs), g.kind, g.special && g.foods[0] === dailySpecial(state))
          m.needsUpdate = true
        }
        rig.bubble.position.y = BUBBLE_Y + Math.sin(time * 2.4 + g.id) * 0.05
      }
      for (const [id, rig] of rigs) {
        if (!live.has(id)) {
          scene.remove(rig.farmer.root)
          rigs.delete(id)
        }
      }
    },

    hitTest(camera, x, y) {
      let best: number | null = null
      let bestD = 60
      for (const [id, rig] of rigs) {
        v.copy(rig.farmer.root.position).setY(0.9).project(camera)
        const d = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y)
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      return best
    },
  }
}

const MOODS = ['😊', '😐', '😠']
const bubbleCache = new Map<string, THREE.Texture>()

/** Bong bóng món: món đang chờ (món thứ hai nhỏ hơn bên cạnh), mặt cười/sốt ruột/bực, vương miện khách sành ăn, sao món đặc biệt. */
function bubbleTexture(key: string, icons: string[], mood: number, kind: string, special: boolean): THREE.Texture {
  let tex = bubbleCache.get(key)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = kind === 'vip' ? 'rgba(255,214,102,0.98)' : 'rgba(255,240,200,0.97)'
  g.strokeStyle = kind === 'vip' ? '#b8860b' : '#b06e33'
  g.lineWidth = 7
  g.beginPath()
  g.arc(80, 86, 56, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const font = (px: number) => `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  if (icons.length > 1) {
    g.font = font(52)
    g.fillText(icons[0], 56, 84)
    g.font = font(40)
    g.fillText(icons[1], 108, 96)
  } else {
    g.font = font(68)
    g.fillText(icons[0], 80, 90)
  }
  g.font = font(38)
  g.fillText(MOODS[mood], 128, 34)
  if (kind === 'vip') g.fillText('👑', 36, 30)
  else if (special) g.fillText('⭐', 36, 30)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  bubbleCache.set(key, tex)
  return tex
}
