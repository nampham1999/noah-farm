import { bus } from '../core/events.ts'
import type { GameState, RestaurantGuest } from '../core/state.ts'
import { RECIPES, FURNITURE_BY_ID } from '../data/index.ts'
import { itemName } from '../i18n/index.ts'
import { coveredCells, furnitureCenter } from './house.ts'
import { roomTypeAt } from './houseStyle.ts'
import { countItem, removeItem } from './inventory.ts'
import { gainXp } from './progress.ts'
import { NPCS } from './orders.ts'

/**
 * Nhà hàng trong nhà: phòng loại "Nhà hàng" có ghế cạnh bàn thì mỗi ghế đón một vị khách.
 * Khách tới theo nhịp, gọi một món nấu ở bếp, chờ tối đa PATIENCE_MS. Bạn mang món ra (chạm khách):
 * nhận tiền cao hơn giá bán thường, phục vụ nhanh còn có tiền boa. Hết kiên nhẫn thì khách bỏ về.
 */

export const PATIENCE_MS = 180_000
const FAST_SHARE = 0.4
const PRICE_MULT = 1.5
const TIP_MULT = 0.3
const ARRIVAL_MIN_MS = 35_000
const ARRIVAL_SPAN_MS = 35_000
const MAX_SEATS = 8

const isChair = (id: string): boolean => /chair|stool/i.test(id)
const isTable = (id: string): boolean => /table|bar|desk/i.test(id)

export interface Seat {
  fl: number
  cx: number
  cz: number
  /** Vị trí ghế và hướng nhìn về phía bàn. */
  x: number
  z: number
  rotY: number
}

/** Ghế dùng được: nằm trong phòng Nhà hàng và có bàn ngay cạnh. */
export function restaurantSeats(state: GameState): Seat[] {
  const out: Seat[] = []
  for (const f of state.house.furniture) {
    if (!isChair(f.id) || FURNITURE_BY_ID.get(f.id)?.kind === 'wall') continue
    const fl = f.fl ?? 0
    if (roomTypeAt(state, fl, f.cx, f.cz) !== 'restaurant') continue
    const table = state.house.furniture.find((t) => {
      if ((t.fl ?? 0) !== fl || !isTable(t.id)) return false
      return coveredCells(t).some((c) => Math.abs(c.cx - f.cx) + Math.abs(c.cz - f.cz) === 1)
    })
    if (!table) continue
    const here = furnitureCenter(f)
    const near = coveredCells(table).find((c) => Math.abs(c.cx - f.cx) + Math.abs(c.cz - f.cz) === 1)!
    const to = furnitureCenter({ ...table, cx: near.cx, cz: near.cz, rot: 0, id: 'table_small' })
    out.push({ fl, cx: f.cx, cz: f.cz, x: here.x, z: here.z, rotY: Math.atan2(to.x - here.x, to.z - here.z) })
    if (out.length >= MAX_SEATS) break
  }
  return out
}

export const guestSeat = (state: GameState, g: RestaurantGuest): Seat | undefined =>
  restaurantSeats(state).find((s) => s.fl === g.fl && s.cx === g.cx && s.cz === g.cz)

/** Gọi thường xuyên (mỗi giây): khách hết kiên nhẫn hoặc mất ghế thì đi, ghế trống thì có khách mới. */
export function updateRestaurant(state: GameState, now: number): void {
  const r = state.restaurant
  const seats = restaurantSeats(state)
  const before = r.guests.length
  r.guests = r.guests.filter((g) => {
    if (!seats.some((s) => s.fl === g.fl && s.cx === g.cx && s.cz === g.cz)) return false
    if (now - g.since > g.patience) {
      r.missed++
      bus.emit('notify', { key: 'restaurant.left', params: { dish: itemName(`food_${g.food}`) } })
      return false
    }
    return true
  })
  const free = seats.filter((s) => !r.guests.some((g) => g.fl === s.fl && g.cx === s.cx && g.cz === s.cz))
  if (free.length && now >= r.nextAt) {
    const seat = free[Math.floor(Math.random() * free.length)]
    const recipe = RECIPES[Math.floor(Math.random() * RECIPES.length)]
    r.guests.push({
      id: ++r.seq,
      look: Math.floor(Math.random() * NPCS.length),
      fl: seat.fl,
      cx: seat.cx,
      cz: seat.cz,
      food: recipe.id,
      since: now,
      patience: PATIENCE_MS,
    })
    r.nextAt = now + ARRIVAL_MIN_MS + Math.random() * ARRIVAL_SPAN_MS
    bus.emit('notify', { key: 'restaurant.arrived', params: { dish: itemName(`food_${recipe.id}`) } })
    bus.emit('saveRequest', undefined)
  } else if (r.guests.length !== before) bus.emit('saveRequest', undefined)
}

/** Mang món ra cho khách: trừ món trong túi, nhận tiền (và tiền boa nếu nhanh). */
export function serveGuest(state: GameState, id: number, now: number): boolean {
  const r = state.restaurant
  const g = r.guests.find((x) => x.id === id)
  if (!g) return false
  const dish = `food_${g.food}`
  const base = RECIPES.find((x) => x.id === g.food)?.sellPrice ?? 50
  if (countItem(state.inventory, dish) < 1) {
    bus.emit('notify', { key: 'restaurant.need', params: { dish: itemName(dish) } })
    return false
  }
  removeItem(state.inventory, dish, 1)
  const fast = now - g.since < g.patience * FAST_SHARE
  const tip = fast ? Math.round(base * TIP_MULT) : 0
  const pay = Math.round(base * PRICE_MULT) + tip
  state.player.gold += pay
  state.stats.goldEarned += pay
  r.served++
  r.earned += pay
  r.guests = r.guests.filter((x) => x.id !== id)
  gainXp(state, 4)
  bus.emit('notify', { key: tip ? 'restaurant.servedTip' : 'restaurant.served', params: { gold: pay, tip }, good: true })
  bus.emit('sfx', 'coin')
  bus.emit('progress', { type: 'sellGold', amount: pay })
  bus.emit('saveRequest', undefined)
  return true
}
