import { bus } from '../core/events.ts'
import type { GameState, Season, Weather } from '../core/state.ts'
import { needsWater } from './farming.ts'

/**
 * Thời tiết: mỗi sáng gieo một kiểu theo mùa.
 * Mưa và giông tự tưới cây ngoài ruộng, làm cá cắn câu nhanh hơn; giông còn dễ gặp cá hiếm.
 */
export const WEATHERS: Weather[] = ['sunny', 'rain', 'storm', 'snow']

/** Xác suất từng kiểu theo mùa (phần còn lại là nắng). */
const CHANCE: Record<Season, Partial<Record<Weather, number>>> = {
  spring: { rain: 0.3, storm: 0.05 },
  summer: { rain: 0.12, storm: 0.12 },
  autumn: { rain: 0.28, storm: 0.07 },
  winter: { snow: 0.45 },
}

/** Mưa thì cá cắn sau chừng này lần thời gian chờ thường. */
export const RAIN_BITE_FACTOR = 0.6

export function isWet(w: Weather): boolean {
  return w === 'rain' || w === 'storm'
}

export function rollWeather(season: Season, rand = Math.random): Weather {
  let r = rand()
  for (const [w, p] of Object.entries(CHANCE[season]) as [Weather, number][]) {
    if (r < p) return w
    r -= p
  }
  return 'sunny'
}

/** Sáng ngày mới: gieo thời tiết và báo cho người chơi nếu không nắng. */
export function startWeatherDay(state: GameState): void {
  const w = rollWeather(state.clock.season)
  setWeather(state, w)
  if (w !== 'sunny') bus.emit('notify', { key: `weather.today.${w}`, good: true })
}

export function setWeather(state: GameState, w: Weather): void {
  if (state.clock.weather === w) return
  state.clock.weather = w
  bus.emit('weatherChanged', w)
}

/** Mỗi khung hình: trời mưa thì ô nào đang khát nước được tưới (đúng mùa hay không cũng thế). */
export function applyWeather(state: GameState, t: number): void {
  if (!isWet(state.clock.weather)) return
  for (const plot of state.plots) {
    if (needsWater(plot)) plot.wateredAt = t
  }
}
