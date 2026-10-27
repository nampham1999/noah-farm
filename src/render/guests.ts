import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RECIPES } from '../data/index.ts'
import { NPCS } from '../systems/orders.ts'
import { guestSeat } from '../systems/restaurant.ts'
import { emojiTexture } from './animals.ts'
import { createCharacter } from './character.ts'
import type { Farmer } from './models.ts'

export interface GuestsView {
  update(state: GameState, time: number): void
  /** Mã khách ở điểm chạm (trong nhà), hoặc null. */
  hitTest(camera: THREE.Camera, x: number, y: number): number | null
}

interface Rig {
  farmer: Farmer
  bubble: THREE.Sprite
  food: string
}

/** Chỗ ngồi hơi thấp hơn sàn đứng để khách "lún" vào ghế. */
const SIT_Y = 0.16
const BUBBLE_Y = 1.75

/** Khách của nhà hàng: ngồi ở ghế, bong bóng món đang chờ trên đầu. */
export function createGuestsView(scene: THREE.Scene): GuestsView {
  const rigs = new Map<number, Rig>()
  const v = new THREE.Vector3()

  return {
    update(state, time) {
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
          bubble.scale.set(0.7, 0.7, 1)
          bubble.position.y = BUBBLE_Y
          farmer.root.add(bubble)
          scene.add(farmer.root)
          rig = { farmer, bubble, food: '' }
          rigs.set(g.id, rig)
        }
        rig.farmer.root.position.set(seat.x, SIT_Y, seat.z)
        rig.farmer.root.rotation.y = seat.rotY
        rig.farmer.animate(0, 0)
        if (rig.food !== g.food) {
          rig.food = g.food
          const m = rig.bubble.material as THREE.SpriteMaterial
          m.map = emojiTexture(RECIPES.find((r) => r.id === g.food)?.icon ?? '🍽️')
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
