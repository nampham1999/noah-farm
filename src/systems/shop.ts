import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { CROPS, item } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem } from './inventory.ts'

export interface ShopEntry {
  itemId: string
  price: number
  /** Cấp cần để mua; lớn hơn cấp người chơi thì hiện khoá. */
  level: number
}

/** Hạt giống bán trong mùa hiện tại, xếp theo cấp mở khoá rồi theo giá (GDD mục 7.1). */
export function seedCatalog(state: GameState): ShopEntry[] {
  return CROPS.filter((c) => c.seasons.includes(state.clock.season))
    .sort((a, b) => a.level - b.level || a.seedPrice - b.seedPrice)
    .map((c) => ({ itemId: `seed_${c.id}`, price: c.seedPrice, level: c.level }))
}

export function buy(state: GameState, entry: ShopEntry, qty: number): boolean {
  const p = state.player
  const cost = entry.price * qty
  if (entry.level > p.level) return fail('notice.locked', { level: entry.level })
  if (p.gold < cost) return fail('notice.noGold')
  if (!canFit(state.inventory, entry.itemId, qty)) return fail('notice.bagFull')
  p.gold -= cost
  addItem(state.inventory, entry.itemId, qty)
  bus.emit('saveRequest', undefined)
  return true
}

/** Bán theo giá cố định (GDD mục 7.3). */
export function sell(state: GameState, itemId: string, qty: number): boolean {
  const price = item(itemId).sellPrice
  if (!price) return false
  const n = Math.min(qty, countItem(state.inventory, itemId))
  if (n <= 0) return false
  removeItem(state.inventory, itemId, n)
  state.player.gold += price * n
  bus.emit('saveRequest', undefined)
  bus.emit('notify', { key: 'notice.sold', params: { item: itemId, qty: n, gold: price * n }, good: true })
  return true
}

/** Các nông sản đang có trong túi, mỗi loại một dòng. */
export function sellableItems(state: GameState): { itemId: string; qty: number; price: number }[] {
  const ids = [...new Set(state.inventory.slots.flatMap((s) => (s && item(s.id).sellPrice ? [s.id] : [])))]
  return ids.map((id) => ({ itemId: id, qty: countItem(state.inventory, id), price: item(id).sellPrice! }))
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}
