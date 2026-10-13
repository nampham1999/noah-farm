import { bus } from '../core/events.ts'
import type { ClockState, GameState, Season } from '../core/state.ts'
import { balance } from '../data/index.ts'
import { startWeatherDay } from './weather.ts'

/**
 * Đồng hồ trong game (GDD mục 3.2): một ngày dài 12 phút thật, một mùa 7 ngày, một năm 4 mùa.
 * Chỉ chạy khi đang mở tab; lúc đóng tab đồng hồ dừng, chỉ cây và vật nuôi được tính bù.
 */
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const MINUTES_PER_DAY = 24 * 60
/** Số phút trong game trôi qua mỗi giây thật. */
export const GAME_MINUTES_PER_SECOND = MINUTES_PER_DAY / (balance.dayRealMinutes * 60)

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'

export function advanceClock(state: GameState, realSeconds: number): void {
  const c = state.clock
  c.minuteOfDay += realSeconds * GAME_MINUTES_PER_SECOND
  while (c.minuteOfDay >= MINUTES_PER_DAY) {
    c.minuteOfDay -= MINUTES_PER_DAY
    startNewDay(state)
  }
}

function startNewDay(state: GameState): void {
  const c = state.clock
  c.day++
  if (c.day > balance.daysPerSeason) {
    c.day = 1
    const next = (SEASONS.indexOf(c.season) + 1) % SEASONS.length
    if (next === 0) c.year++
    c.season = SEASONS[next]
    bus.emit('seasonChanged', c.season)
    bus.emit('notify', { key: 'clock.newSeason', params: { name: `season.${c.season}` }, good: true })
  }
  // Ngủ qua đêm: sáng ra thể lực đầy lại.
  state.player.stamina = balance.staminaMax
  startWeatherDay(state)
  bus.emit('newDay', c.day)
  bus.emit('notify', { key: 'clock.newDay', params: { day: c.day }, good: true })
  bus.emit('saveRequest', undefined)
}

export function dayPhase(minuteOfDay: number): DayPhase {
  const h = minuteOfDay / 60
  if (h >= 5 && h < 7) return 'dawn'
  if (h >= 7 && h < 18) return 'day'
  if (h >= 18 && h < 20) return 'dusk'
  return 'night'
}

/** Số ngày tính từ đầu game (ngày 1 xuân năm 1 là 0), để trừ ra số ngày còn lại. */
export function absDay(c: ClockState): number {
  return ((c.year - 1) * SEASONS.length + SEASONS.indexOf(c.season)) * balance.daysPerSeason + (c.day - 1)
}
