import { bus } from '../core/events.ts'
import type { GameState, Order } from '../core/state.ts'
import { mulberry32 } from '../core/random.ts'
import { ANIMAL_BY_ID, CROPS, FISH, item } from '../data/index.ts'
import npcData from '../data/npcs.json'
import { absDay } from './clock.ts'
import { addItem, canFit, countItem, removeItem } from './inventory.ts'
import { gainXp } from './progress.ts'

/**
 * Bảng đơn hàng của dân làng (theo bản cũ cozyfarmy.com): mỗi đơn xin vài món,
 * có hạn vài ngày; thưởng 1,5 lần giá bán; có đơn gấp (giao trong ngày, thưởng gấp đôi)
 * và đôi khi tặng kèm hạt giống.
 */

export interface NpcDef {
  id: string
  emoji: string
  shirt: string
  pants: string
  hat: string
  lines: number
}

export const NPCS = npcData.npcs as NpcDef[]
const CFG = npcData.orders

export function npcDef(id: string): NpcDef {
  return NPCS.find((n) => n.id === id) ?? NPCS[0]
}

export function daysLeft(state: GameState, o: Order): number {
  return o.dueDay - absDay(state.clock)
}

export function canDeliver(state: GameState, o: Order): boolean {
  return o.lines.every((l) => countItem(state.inventory, l.itemId) >= l.qty)
}

/**
 * Bỏ đơn quá hạn, rồi thêm đơn mới cho đủ số lượng (gọi khi mở game và sang ngày mới).
 * Mỗi ngày game chỉ thêm đơn một lần, để tải lại trang không sinh thêm đơn.
 */
export function refillOrders(state: GameState): void {
  const today = absDay(state.clock)
  const o = state.orders
  for (const order of o.list.filter((x) => x.dueDay < today)) {
    bus.emit('notify', { key: 'order.expired', params: { name: `npc.${order.npc}` } })
  }
  o.list = o.list.filter((x) => x.dueDay >= today)
  if (o.lastRefill === today) return
  o.lastRefill = today

  if (!o.firstGiven) {
    o.firstGiven = true
    const f = CFG.first
    o.list.push(makeOrder(state, f.npc, [{ itemId: f.itemId, qty: f.qty }], f.gold, f.days, false, null, true))
  }
  const rand = mulberry32(today * 4099 + o.nextId)
  while (o.list.length < CFG.max) {
    const order = randomOrder(state, rand)
    if (!order) break
    o.list.push(order)
  }
}

/** Những món dân làng có thể xin: nông sản đúng mùa và đủ cấp, sản phẩm vật nuôi đang có, cá đã từng câu. */
function wanted(state: GameState): string[] {
  const crops = CROPS.filter((c) => c.seasons.includes(state.clock.season) && c.level <= state.player.level).map((c) => `crop_${c.id}`)
  const products = [...new Set(state.animals.map((a) => ANIMAL_BY_ID.get(a.type)!.product))]
  const fish = FISH.filter((f) => state.journal.fish[f.id]).map((f) => `fish_${f.id}`)
  return [...crops, ...products, ...fish]
}

function randomOrder(state: GameState, rand: () => number): Order | null {
  const pool = wanted(state)
  if (pool.length === 0) return null
  const busy = new Set(state.orders.list.map((x) => x.npc))
  const free = NPCS.filter((n) => !busy.has(n.id))
  const npc = (free.length ? free : NPCS)[Math.floor(rand() * (free.length || NPCS.length))].id
  const pick = (from: string[]) => from[Math.floor(rand() * from.length)]

  // Số lượng theo cấp và số ô đang có, để đơn làm được trong vài ngày.
  const cap = Math.max(CFG.minQty, Math.floor(state.plots.length * CFG.ownedShare))
  const qtyFor = (id: string) => {
    const base = item(id).kind === 'crop' ? 3 + 2 * state.player.level : 1 + state.player.level / 3
    return Math.max(1, Math.min(cap, Math.round(base * (0.7 + rand() * 0.6))))
  }
  let lines: { itemId: string; qty: number }[]
  if (pool.length >= 2 && rand() < 0.3) {
    const a = pick(pool)
    const b = pick(pool.filter((x) => x !== a))
    lines = [{ itemId: a, qty: Math.max(1, Math.round(qtyFor(a) * 0.6)) }, { itemId: b, qty: Math.max(1, Math.round(qtyFor(b) * 0.4)) }]
  } else {
    const a = pick(pool)
    lines = [{ itemId: a, qty: qtyFor(a) }]
  }

  const rush = rand() < CFG.rushChance
  const value = lines.reduce((sum, l) => sum + (item(l.itemId).sellPrice ?? 0) * l.qty, 0)
  let gold = round5(value * CFG.rewardMultiplier)
  if (rush) gold *= 2
  const days = rush ? 0 : CFG.daysMin + Math.floor(rand() * (CFG.daysMax - CFG.daysMin + 1))
  const seeds = pool.filter((id) => id.startsWith('crop_'))
  const bonus = !rush && seeds.length && rand() < CFG.bonusChance ? { itemId: `seed_${pick(seeds).slice(5)}`, qty: 5 } : null
  return makeOrder(state, npc, lines, gold, days, rush, bonus, false)
}

function makeOrder(state: GameState, npc: string, lines: Order['lines'], gold: number, days: number, rush: boolean, bonus: Order['bonus'], scripted: boolean): Order {
  return {
    id: state.orders.nextId++,
    npc,
    lines,
    gold,
    xp: 10 + Math.round(gold / 10),
    dueDay: absDay(state.clock) + days,
    rush,
    bonus,
    scripted,
  }
}

/** Giao hàng cho một đơn: trừ hàng, cộng vàng, XP, quà kèm. */
export function deliver(state: GameState, id: number): boolean {
  const o = state.orders.list.find((x) => x.id === id)
  if (!o) return false
  if (!canDeliver(state, o)) {
    bus.emit('notify', { key: 'order.missing' })
    return false
  }
  if (o.bonus && !canFit(state.inventory, o.bonus.itemId, o.bonus.qty)) {
    bus.emit('notify', { key: 'notice.bagFull' })
    return false
  }
  for (const l of o.lines) removeItem(state.inventory, l.itemId, l.qty)
  if (o.bonus) addItem(state.inventory, o.bonus.itemId, o.bonus.qty)
  state.player.gold += o.gold
  gainXp(state, o.xp)
  state.orders.list = state.orders.list.filter((x) => x.id !== id)
  bus.emit('notify', { key: 'order.delivered', params: { name: `npc.${o.npc}`, gold: o.gold, xp: o.xp }, good: true })
  bus.emit('progress', { type: 'deliver', amount: 1, id: o.npc })
  bus.emit('sfx', 'coin')
  bus.emit('saveRequest', undefined)
  return true
}

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5)
}
