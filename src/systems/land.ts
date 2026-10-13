import { bus } from '../core/events.ts'
import { blockPlots, greenhousePlots, type GameState } from '../core/state.ts'
import { LAND_BLOCKS } from '../core/world.ts'
import { balance } from '../data/index.ts'

/** Giá khu ruộng kế tiếp; null nếu đã mua hết (GDD mục 7.3: 500, 1000, 2000, 4000 vàng). */
export function nextLandPrice(state: GameState): number | null {
  return state.landLevel + 1 < LAND_BLOCKS.length ? balance.landPrices[state.landLevel] : null
}

/** Mua thêm một khu ruộng 16 ô. */
export function buyLand(state: GameState): boolean {
  const price = nextLandPrice(state)
  if (price === null) return false
  if (state.player.gold < price) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= price
  state.landLevel++
  state.plots.push(...blockPlots(state.landLevel))
  bus.emit('notify', { key: 'land.bought', params: { n: state.plots.length }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

export const GREENHOUSE_PRICE = 3000
export const GREENHOUSE_LEVEL = 4

/** Dựng nhà kính: thêm luống 8 ô trồng được mọi mùa. */
export function buyGreenhouse(state: GameState): boolean {
  if (state.greenhouse) return false
  if (state.player.level < GREENHOUSE_LEVEL) {
    bus.emit('notify', { key: 'notice.locked', params: { level: GREENHOUSE_LEVEL } })
    return false
  }
  if (state.player.gold < GREENHOUSE_PRICE) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= GREENHOUSE_PRICE
  state.greenhouse = true
  state.plots.push(...greenhousePlots())
  bus.emit('notify', { key: 'greenhouse.built', good: true })
  bus.emit('saveRequest', undefined)
  return true
}

