import { bus } from '../core/events.ts'
import type { GameState, RestaurantGuest } from '../core/state.ts'
import { RECIPES, FURNITURE_BY_ID } from '../data/index.ts'
import { absDay } from './clock.ts'
import { itemName } from '../i18n/index.ts'
import { coveredCells, furnitureCenter } from './house.ts'
import { RESTAURANT_TABLES } from '../core/world.ts'
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
const VIP_PATIENCE_MS = 110_000
const FAST_SHARE = 0.4
const PRICE_MULT = 1.5
const SPECIAL_MULT = 1.5
const VIP_MULT = 2.2
const FAMILY_BONUS = 1.15
const TIP_BASE = 0.3
const TIP_PER_STAR = 0.06
/** Người phục vụ lấy món từ kệ: chậm hơn người chơi một chút, không có tiền boa và ăn 10% công. */
export const WAITER_EVERY_MS = 7000
const WAITER_CUT = 0.9
export const STOCK_MAX = 20
/** Điểm danh tiếng để lên 2, 3, 4, 5 sao. */
export const STAR_AT = [40, 120, 300, 650]
const ARRIVAL_MIN_MS = 35_000
const ARRIVAL_SPAN_MS = 35_000
const QUICK_MIN_MS = 10_000
const QUICK_SPAN_MS = 10_000
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

/** Ghế ngoài sân nhà hàng: mỗi cấp mở một bàn, hai ghế đối diện nhau. */
export function courtSeats(state: GameState): Seat[] {
  const out: Seat[] = []
  RESTAURANT_TABLES.slice(0, state.restaurant.level).forEach((t, i) => {
    out.push({ fl: -1, cx: i * 2, cz: 0, x: t.x - 1.15, z: t.z, rotY: Math.PI / 2 })
    out.push({ fl: -1, cx: i * 2 + 1, cz: 0, x: t.x + 1.15, z: t.z, rotY: -Math.PI / 2 })
  })
  return out
}

export const allSeats = (state: GameState): Seat[] => [...restaurantSeats(state), ...courtSeats(state)]

export const guestSeat = (state: GameState, g: RestaurantGuest): Seat | undefined =>
  allSeats(state).find((s) => s.fl === g.fl && s.cx === g.cx && s.cz === g.cz)

/** Nâng cấp nhà hàng ngoài phố: giá và cấp người chơi cần cho mỗi cấp. */
export const RESTAURANT_LEVELS = [
  { price: 1200, level: 3 },
  { price: 3000, level: 5 },
  { price: 7000, level: 7 },
  { price: 15000, level: 9 },
]

export function nextRestaurantLevel(state: GameState): { price: number; level: number } | null {
  return RESTAURANT_LEVELS[state.restaurant.level] ?? null
}

/** Bếp nhà hàng đi kèm nhà hàng, không phải mua riêng. */
export function ensureKitchen(state: GameState): void {
  if (state.restaurant.level > 0 && !state.machines.some((m) => m.id === 'stove')) state.machines.push({ id: 'stove', output: null, qty: 0, readyAt: 0 })
}

export function upgradeRestaurant(state: GameState): boolean {
  const next = nextRestaurantLevel(state)
  if (!next) return false
  if (state.player.level < next.level) {
    bus.emit('notify', { key: 'notice.locked', params: { level: next.level } })
    return false
  }
  if (state.player.gold < next.price) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= next.price
  state.restaurant.level++
  ensureKitchen(state)
  bus.emit('notify', { key: state.restaurant.level === 1 ? 'restaurant.opened' : 'restaurant.upgraded', params: { n: state.restaurant.level * 2 }, good: true })
  bus.emit('sfx', 'levelUp')
  bus.emit('saveRequest', undefined)
  return true
}

/** Số sao nhà hàng (1..5) theo điểm danh tiếng. */
export function restaurantStars(state: GameState): number {
  return 1 + STAR_AT.filter((v) => state.restaurant.rep >= v).length
}

/** Món đặc biệt của ngày (đổi mỗi ngày trong game): khách gọi món này trả thêm 50%. */
export function dailySpecial(state: GameState): string {
  return RECIPES[(absDay(state.clock) * 7 + 3) % RECIPES.length].id
}

/** Giờ cao điểm (bữa trưa và bữa tối): khách tới nhanh gấp đôi. */
export function isRush(state: GameState): boolean {
  const m = state.clock.minuteOfDay
  return (m >= 11 * 60 && m < 13.5 * 60) || (m >= 18 * 60 && m < 20.5 * 60)
}

const recipeOf = (id: string) => RECIPES.find((r) => r.id === id)
const priceOf = (id: string): number => recipeOf(id)?.sellPrice ?? 50

/** Tiền một món khách trả (chưa tính tiền boa): đã nhân giá nhà hàng, món đặc biệt và loại khách. */
export function dishPay(state: GameState, g: RestaurantGuest, food: string): number {
  let mult = PRICE_MULT
  if (g.special && food === dailySpecial(state)) mult *= SPECIAL_MULT
  if (g.kind === 'vip') mult *= VIP_MULT
  return Math.round(priceOf(food) * mult)
}

/** Tâm trạng khách theo thời gian đã chờ: 0 vui, 1 hơi sốt ruột, 2 bực. */
export function guestMood(g: RestaurantGuest, now: number): 0 | 1 | 2 {
  const used = (now - g.since) / g.patience
  return used < 0.4 ? 0 : used < 0.75 ? 1 : 2
}

/** Gọi thường xuyên (mỗi giây): khách hết kiên nhẫn hoặc mất ghế thì đi, ghế trống thì có khách mới, nhân viên phục vụ làm việc. */
export function updateRestaurant(state: GameState, now: number): void {
  const r = state.restaurant
  const seats = allSeats(state)
  const before = r.guests.length
  r.guests = r.guests.filter((g) => {
    if (!seats.some((s) => s.fl === g.fl && s.cx === g.cx && s.cz === g.cz)) return false
    if (now - g.since > g.patience) {
      r.missed++
      r.rep = Math.max(0, r.rep - (g.kind === 'vip' ? 12 : 6))
      bus.emit('notify', { key: 'restaurant.left', params: { dish: itemName(`food_${g.foods[0]}`) } })
      return false
    }
    return true
  })
  const free = seats.filter((s) => !r.guests.some((g) => g.fl === s.fl && g.cx === s.cx && g.cz === s.cz))
  if (free.length && now >= r.nextAt) {
    const seat = free[Math.floor(Math.random() * free.length)]
    const stars = restaurantStars(state)
    const roll = Math.random()
    const pool = [...RECIPES].sort((a, b) => b.sellPrice - a.sellPrice)
    let kind: RestaurantGuest['kind'] = 'regular'
    // Khách sành ăn chỉ ghé khi nhà hàng từ 2 sao; gia đình cần thêm một ghế trống.
    if (stars >= 2 && roll < 0.1 + 0.02 * stars) kind = 'vip'
    else if (free.length >= 2 && roll < 0.35) kind = 'family'
    const special = kind !== 'vip' && Math.random() < 0.35
    const pick = (): string =>
      kind === 'vip' ? pool[Math.floor(Math.random() * Math.ceil(pool.length / 3))].id : special && !r.guests.length ? dailySpecial(state) : RECIPES[Math.floor(Math.random() * RECIPES.length)].id
    const foods = [pick()]
    if (kind === 'family') foods.push(RECIPES[Math.floor(Math.random() * RECIPES.length)].id)
    if (special && kind === 'regular') foods[0] = dailySpecial(state)
    r.guests.push({
      id: ++r.seq,
      look: Math.floor(Math.random() * NPCS.length),
      fl: seat.fl,
      cx: seat.cx,
      cz: seat.cz,
      foods,
      kind,
      special,
      since: now,
      patience: kind === 'vip' ? VIP_PATIENCE_MS : PATIENCE_MS,
    })
    // Giờ cao điểm và nhiều sao thì khách tới dồn dập hơn; vắng khách thì tới nhanh hơn.
    const gap = r.guests.length <= 1 ? QUICK_MIN_MS + Math.random() * QUICK_SPAN_MS : ARRIVAL_MIN_MS + Math.random() * ARRIVAL_SPAN_MS
    r.nextAt = now + gap * (isRush(state) ? 0.5 : 1) * (1 - 0.06 * (stars - 1))
    bus.emit('notify', { key: kind === 'vip' ? 'restaurant.arrivedVip' : kind === 'family' ? 'restaurant.arrivedFamily' : 'restaurant.arrived', params: { dish: itemName(`food_${foods[0]}`) } })
    bus.emit('saveRequest', undefined)
  } else if (r.guests.length !== before) bus.emit('saveRequest', undefined)
  waiterTick(state, now)
}

let lastWaiter = 0

/** Nhân viên phục vụ: cứ vài giây mang một món có trên kệ ra cho khách đang chờ. */
function waiterTick(state: GameState, now: number): void {
  const r = state.restaurant
  if (!r.waiter || now - lastWaiter < WAITER_EVERY_MS) return
  for (const g of r.guests) {
    const food = g.foods.find((f) => (r.stock[f] ?? 0) > 0)
    if (!food) continue
    lastWaiter = now
    r.stock[food]--
    payDish(state, g, food, now, true)
    return
  }
}

/** Trả tiền một món và xử lý khách (bớt món, hoặc rời đi khi đủ món). */
function payDish(state: GameState, g: RestaurantGuest, food: string, now: number, byWaiter: boolean): void {
  const r = state.restaurant
  const fast = now - g.since < g.patience * FAST_SHARE
  const stars = restaurantStars(state)
  const base = dishPay(state, g, food)
  const tip = !byWaiter && fast ? Math.round(base * (TIP_BASE + TIP_PER_STAR * (stars - 1)) / PRICE_MULT) : 0
  let pay = Math.round(byWaiter ? base * WAITER_CUT : base) + tip
  g.foods.splice(g.foods.indexOf(food), 1)
  const done = g.foods.length === 0
  if (done && g.kind === 'family') pay = Math.round(pay * FAMILY_BONUS)
  state.player.gold += pay
  state.stats.goldEarned += pay
  r.earned += pay
  r.rep += (g.kind === 'vip' ? 6 : 2) + (fast ? 1 : 0)
  if (done) {
    r.served++
    r.guests = r.guests.filter((x) => x.id !== g.id)
    gainXp(state, g.kind === 'vip' ? 8 : 4)
  }
  const star = restaurantStars(state)
  if (star > stars) bus.emit('notify', { key: 'restaurant.star', params: { n: star }, good: true })
  bus.emit('notify', { key: byWaiter ? 'restaurant.servedByWaiter' : tip ? 'restaurant.servedTip' : 'restaurant.served', params: { gold: pay, tip }, good: true })
  bus.emit('sfx', 'coin')
  bus.emit('progress', { type: 'sellGold', amount: pay })
  bus.emit('saveRequest', undefined)
}

/** Mang món ra cho khách: lấy món trong túi mà khách đang chờ (khách gia đình gọi nhiều món, phục vụ từng món). */
export function serveGuest(state: GameState, id: number, now: number): boolean {
  const r = state.restaurant
  const g = r.guests.find((x) => x.id === id)
  if (!g) return false
  const food = g.foods.find((f) => countItem(state.inventory, `food_${f}`) > 0)
  if (!food) {
    bus.emit('notify', { key: 'restaurant.need', params: { dish: itemName(`food_${g.foods[0]}`) } })
    return false
  }
  removeItem(state.inventory, `food_${food}`, 1)
  payDish(state, g, food, now, false)
  return true
}

/** Cất món trong túi lên kệ trưng bày của nhà hàng (tối đa STOCK_MAX mỗi món). */
export function stockDish(state: GameState, food: string, qty: number): number {
  const r = state.restaurant
  const n = Math.min(qty, countItem(state.inventory, `food_${food}`), STOCK_MAX - (r.stock[food] ?? 0))
  if (n <= 0) return 0
  removeItem(state.inventory, `food_${food}`, n)
  r.stock[food] = (r.stock[food] ?? 0) + n
  bus.emit('saveRequest', undefined)
  return n
}

export const WAITER_PRICE = 2500
export const WAITER_LEVEL = 5

/** Thuê nhân viên phục vụ: tự lấy món trên kệ mang ra cho khách. */
export function hireWaiter(state: GameState): boolean {
  const r = state.restaurant
  if (r.waiter || r.level < 1) return false
  if (state.player.level < WAITER_LEVEL) {
    bus.emit('notify', { key: 'notice.locked', params: { level: WAITER_LEVEL } })
    return false
  }
  if (state.player.gold < WAITER_PRICE) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= WAITER_PRICE
  r.waiter = true
  bus.emit('notify', { key: 'restaurant.hired', good: true })
  bus.emit('sfx', 'levelUp')
  bus.emit('saveRequest', undefined)
  return true
}
