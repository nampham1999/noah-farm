import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { FARM_HALF, PEN } from '../core/world.ts'
import { dayStamp } from './animals.ts'
import { gainXp } from './progress.ts'

/**
 * Cáo đêm: khi có gà mà chuồng chưa có hàng rào, đêm nào cũng có thể có một con cáo
 * lẻn từ mép rừng vào bãi thả. Chạm vào cáo hoặc lại gần là nó bỏ chạy (được chút XP);
 * để nó tới chuồng thì mất trứng sắp đẻ của một con gà. Hàng rào chuồng chặn hẳn cáo.
 */

export const COOP_FENCE_PRICE = 400
const NIGHT_CHANCE = 0.4
const SNEAK_SPEED = 1.1
const FLEE_SPEED = 6
const SCARE_RANGE = 2.5
const SCARE_XP = 5

export type FoxPhase = 'none' | 'sneak' | 'flee'

export interface Fox {
  phase: FoxPhase
  x: number
  z: number
  rotY: number
  /** Đêm (dayStamp) đã xét có cáo hay chưa, để mỗi đêm chỉ gieo một lần. */
  night: number
}

export const fox: Fox = { phase: 'none', x: 0, z: 0, rotY: 0, night: -1 }

function isNight(minute: number): boolean {
  const h = minute / 60
  return h >= 21 || h < 4
}

export function buyCoopFence(state: GameState): boolean {
  if (state.coopFence || state.coopLevel === 0) return false
  if (state.player.gold < COOP_FENCE_PRICE) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= COOP_FENCE_PRICE
  state.coopFence = true
  if (fox.phase === 'sneak') fox.phase = 'flee'
  bus.emit('notify', { key: 'fox.fenceBuilt', good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/** Đuổi cáo (chạm vào nó hoặc lại gần). */
export function scareFox(state: GameState): void {
  if (fox.phase !== 'sneak') return
  fox.phase = 'flee'
  gainXp(state, SCARE_XP)
  bus.emit('notify', { key: 'fox.scared', good: true })
  bus.emit('sfx', 'dog')
}

export function updateFox(state: GameState, dt: number): void {
  const p = state.player
  if (fox.phase === 'none') {
    const stamp = dayStamp(state.clock)
    const hasChickens = state.animals.some((a) => a.type === 'chicken')
    if (!isNight(state.clock.minuteOfDay) || state.coopFence || !hasChickens || fox.night === stamp) return
    fox.night = stamp
    if (Math.random() > NIGHT_CHANCE) return
    // Xuất hiện ở mép rừng phía đông, gần chuồng.
    fox.x = FARM_HALF + 1.5
    fox.z = PEN.z + (Math.random() - 0.5) * 6
    fox.phase = 'sneak'
    bus.emit('notify', { key: 'fox.coming' })
    return
  }

  if (fox.phase === 'sneak') {
    // Người chơi (hoặc chó) lại gần thì cáo sợ chạy.
    if (!p.indoors && Math.hypot(p.pos[0] - fox.x, p.pos[2] - fox.z) < SCARE_RANGE) return scareFox(state)
    const dx = PEN.x - fox.x
    const dz = PEN.z - fox.z
    const d = Math.hypot(dx, dz)
    if (d < 1) {
      steal(state)
      fox.phase = 'flee'
      return
    }
    fox.x += (dx / d) * SNEAK_SPEED * dt
    fox.z += (dz / d) * SNEAK_SPEED * dt
    fox.rotY = Math.atan2(dx, dz)
    // Trời sáng mà chưa tới thì bỏ về.
    if (!isNight(state.clock.minuteOfDay)) fox.phase = 'flee'
    return
  }

  // Bỏ chạy ra khỏi nông trại về phía đông.
  fox.x += FLEE_SPEED * dt
  fox.rotY = Math.PI / 2
  if (fox.x > FARM_HALF + 4) fox.phase = 'none'
}

function steal(state: GameState): void {
  const chickens = state.animals.filter((a) => a.type === 'chicken' && a.progress > 0)
  const victim = chickens.sort((a, b) => b.progress - a.progress)[0]
  if (victim) victim.progress = 0
  bus.emit('notify', { key: 'fox.stole' })
  bus.emit('sfx', 'escape')
  bus.emit('saveRequest', undefined)
}
