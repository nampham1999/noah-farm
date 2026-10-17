import { bus } from '../core/events.ts'
import type { GameState, PlotState } from '../core/state.ts'
import { isRipe } from './farming.ts'

/**
 * Sâu phá ruộng: mỗi sáng có khả năng một cây đang lớn bị sâu; cây bị sâu ngừng lớn tới khi
 * được bắt (chủ ruộng tự bắt, hoặc bạn bè ghé thăm bắt giúp và cả hai được thưởng).
 */

const DAILY_CHANCE = 0.35
const MAX_PESTS = 3
/** Sâu chỉ xuất hiện khi người chơi vừa tương tác trong khoảng này: treo máy thì nông trại không bị sâu phá. */
const ACTIVE_MS = 5 * 60_000
let lastActive = Date.now()

/** Ghi nhận người chơi đang chơi (di chuyển, chạm, bấm nút). */
export function markActive(): void {
  lastActive = Date.now()
}

export function plotKey(p: { x: number; z: number }): string {
  return `${p.x},${p.z}`
}

export function hasPest(state: GameState, plot: PlotState): boolean {
  return state.pests.includes(plotKey(plot))
}

/** Sáng ngày mới: có thể có sâu bò vào một cây đang lớn. */
export function pestsNewDay(state: GameState): void {
  if (state.pests.length >= MAX_PESTS || Math.random() > DAILY_CHANCE || Date.now() - lastActive > ACTIVE_MS) return
  const growing = state.plots.filter((p) => p.crop && !isRipe(p) && !hasPest(state, p))
  if (!growing.length) return
  const plot = growing[Math.floor(Math.random() * growing.length)]
  state.pests.push(plotKey(plot))
  bus.emit('notify', { key: 'pest.appeared' })
}

/** Bắt sâu ở ô này (chủ ruộng tự bắt hoặc bạn bè bắt giúp). */
export function removePest(state: GameState, key: string): boolean {
  const i = state.pests.indexOf(key)
  if (i < 0) return false
  state.pests.splice(i, 1)
  bus.emit('saveRequest', undefined)
  return true
}
