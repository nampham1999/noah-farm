import { bus, type Progress } from '../core/events.ts'
import type { GameState, Season } from '../core/state.ts'
import { item } from '../data/index.ts'
import { dayStamp } from './animals.ts'
import { addItem, canFit } from './inventory.ts'

/**
 * Lễ hội theo mùa: ngày FESTIVAL_DAY mỗi mùa. Mỗi lễ hội có một thử thách trong ngày
 * (thu hoạch, câu cá, bán hàng, giao đơn); xong thì nhận vàng và một món nội thất.
 * Hội chợ mùa thu còn mua nông sản giá cao hơn.
 */

export type FestivalId = 'flower' | 'fishing' | 'fair' | 'lantern'

export const FESTIVAL_DAY = 4
/** Hội chợ mùa thu: quầy mua nông sản, quả, đồ ủ, món ăn với giá nhân chừng này. */
export const FAIR_BONUS = 1.5

const BY_SEASON: Record<Season, FestivalId> = { spring: 'flower', summer: 'fishing', autumn: 'fair', winter: 'lantern' }

export interface FestivalGoal {
  progress: Progress['type']
  target: number
  gold: number
  furniture: string
  icon: string
}

export const FESTIVALS: Record<FestivalId, FestivalGoal> = {
  flower: { progress: 'harvest', target: 10, gold: 250, furniture: 'plant_big', icon: '🌸' },
  fishing: { progress: 'fish', target: 5, gold: 300, furniture: 'aquarium', icon: '🎣' },
  fair: { progress: 'sellGold', target: 800, gold: 300, furniture: 'bookcase', icon: '🎪' },
  lantern: { progress: 'deliver', target: 2, gold: 300, furniture: 'fireplace', icon: '🏮' },
}

export function festivalToday(state: GameState): FestivalId | null {
  return state.clock.day === FESTIVAL_DAY ? BY_SEASON[state.clock.season] : null
}

/** Tiến độ thử thách hôm nay (về 0 khi sang lễ hội khác). */
export function festivalProgress(state: GameState): { progress: number; done: boolean } {
  const stamp = dayStamp(state.clock)
  if (state.festival?.stamp !== stamp) return { progress: 0, done: false }
  return state.festival
}

export function sellMultiplier(state: GameState, itemId: string): number {
  if (festivalToday(state) !== 'fair') return 1
  const kind = item(itemId).kind
  return kind === 'crop' || kind === 'fruit' || kind === 'jar' || kind === 'food' ? FAIR_BONUS : 1
}

/** Sáng ngày lễ hội: báo cho người chơi. */
export function festivalNewDay(state: GameState): void {
  const id = festivalToday(state)
  if (id) bus.emit('notify', { key: `festival.start.${id}`, params: { n: FESTIVALS[id].target }, good: true })
}

/** Theo dõi việc người chơi làm trong ngày lễ hội. */
export function onFestivalProgress(state: GameState, ev: Progress): void {
  const id = festivalToday(state)
  if (!id) return
  const goal = FESTIVALS[id]
  if (ev.type !== goal.progress) return
  const stamp = dayStamp(state.clock)
  if (state.festival?.stamp !== stamp) state.festival = { stamp, progress: 0, done: false }
  const f = state.festival
  if (f.done) return
  f.progress += ev.amount
  if (f.progress < goal.target) return
  f.done = true
  state.player.gold += goal.gold
  const furn = `furn_${goal.furniture}`
  if (canFit(state.inventory, furn, 1)) addItem(state.inventory, furn, 1)
  bus.emit('notify', { key: 'festival.done', params: { name: `festival.${id}`, gold: goal.gold, item: furn }, good: true })
  bus.emit('saveRequest', undefined)
}

/** Lễ hội kế tiếp (mùa này nếu chưa tới ngày, không thì mùa sau). */
export function nextFestival(state: GameState): { id: FestivalId; season: Season } {
  const order: Season[] = ['spring', 'summer', 'autumn', 'winter']
  const i = order.indexOf(state.clock.season)
  const season = state.clock.day < FESTIVAL_DAY ? order[i] : order[(i + 1) % 4]
  return { id: BY_SEASON[season], season }
}

