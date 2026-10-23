import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { balance, item, xpToNext } from '../data/index.ts'
import { isRested } from './houseStyle.ts'
import { removeItem } from './inventory.ts'

/** Cộng XP và xử lý lên cấp (có thể lên nhiều cấp một lúc). */
export function gainXp(state: GameState, amount: number): void {
  if (amount <= 0) return
  const p = state.player
  p.xp += amount
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level)
    p.level++
    bus.emit('levelUp', p.level)
    bus.emit('notify', { key: 'notice.levelUp', params: { level: p.level }, good: true })
  }
}

/** Hệ số tốn thể lực khi đang "ngủ ngon". */
const RESTED_COST = 0.8

export function useStamina(state: GameState, amount: number): void {
  state.player.stamina = Math.max(0, state.player.stamina - (isRested(state) ? amount * RESTED_COST : amount))
}

/** Hệ số tốc độ đi: hết thể lực thì đi chậm (GDD mục 3.6). */
export function speedMultiplier(state: GameState): number {
  return state.player.stamina > 0 ? 1 : balance.lowStaminaSpeed
}

/** Ăn món hồi ít thể lực nhất mà vẫn đủ, để giữ món ngon cho lúc cần. */
export function eat(state: GameState): void {
  const p = state.player
  const missing = balance.staminaMax - p.stamina
  if (missing <= 0) {
    bus.emit('notify', { key: 'notice.notHungry' })
    return
  }
  const foods = [...new Set(state.inventory.slots.flatMap((s) => (s && item(s.id).energy ? [s.id] : [])))]
    .map((id) => ({ id, energy: item(id).energy! }))
    .sort((a, b) => a.energy - b.energy)
  if (foods.length === 0) {
    bus.emit('notify', { key: 'notice.noFood' })
    return
  }
  const food = foods.find((f) => f.energy >= missing) ?? foods[foods.length - 1]
  removeItem(state.inventory, food.id, 1)
  p.stamina = Math.min(balance.staminaMax, p.stamina + food.energy)
  bus.emit('notify', { key: 'notice.ate', params: { item: food.id, energy: food.energy }, good: true })
}
