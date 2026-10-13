import { bus } from '../core/events.ts'
import type { GameState, PlacedFurniture } from '../core/state.ts'
import { HOUSE_DOOR, ROOM, ROOM_ENTRY, roomCorner, setRoomSize } from '../core/world.ts'
import { FURNITURE_BY_ID, type FurnitureDef } from '../data/index.ts'
import { advanceClock, GAME_MINUTES_PER_SECOND } from './clock.ts'
import { addItem, canFit, countItem, removeItem } from './inventory.ts'

/**
 * Nhà và trang trí (GDD mục 3.5): một phòng, đặt đồ theo lưới, xoay 90 độ.
 * Trang trí không ảnh hưởng chỉ số; giường dùng để ngủ qua đêm.
 */

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/** Hai ô giữa cạnh nam là lối ra cửa, không được đặt đồ chắn (phòng to ra theo cấp nhà). */
function doorCells(): { cx: number; cz: number }[] {
  return [
    { cx: ROOM.w / 2 - 1, cz: ROOM.d - 1 },
    { cx: ROOM.w / 2, cz: ROOM.d - 1 },
  ]
}

export function furnitureDef(id: string): FurnitureDef {
  return FURNITURE_BY_ID.get(id)!
}

/** Kích thước món đồ (số ô) sau khi xoay. */
export function footprint(def: FurnitureDef, rot: number): { w: number; d: number } {
  return rot % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w }
}

function cells(id: string, cx: number, cz: number, rot: number): { cx: number; cz: number }[] {
  const { w, d } = footprint(furnitureDef(id), rot)
  const out: { cx: number; cz: number }[] = []
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push({ cx: cx + i, cz: cz + j })
  return out
}

/** Đặt được không: trong phòng, không chắn cửa, không chồng lên đồ cùng lớp (thảm chỉ chồng thảm). */
export function canPlace(state: GameState, id: string, cx: number, cz: number, rot: number, ignore = -1): boolean {
  const rug = furnitureDef(id).kind === 'rug'
  const mine = cells(id, cx, cz, rot)
  if (mine.some((c) => c.cx < 0 || c.cz < 0 || c.cx >= ROOM.w || c.cz >= ROOM.d)) return false
  if (!rug && mine.some((c) => doorCells().some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  return state.house.furniture.every((f, i) => {
    if (i === ignore || (furnitureDef(f.id).kind === 'rug') !== rug) return true
    const theirs = cells(f.id, f.cx, f.cz, f.rot)
    return !mine.some((a) => theirs.some((b) => a.cx === b.cx && a.cz === b.cz))
  })
}

/** Món đồ ở ô (cx, cz); ưu tiên đồ đặt trên thảm. -1 nếu trống. */
export function furnitureAt(state: GameState, cx: number, cz: number): number {
  let rugHit = -1
  for (let i = state.house.furniture.length - 1; i >= 0; i--) {
    const f = state.house.furniture[i]
    if (!cells(f.id, f.cx, f.cz, f.rot).some((c) => c.cx === cx && c.cz === cz)) continue
    if (furnitureDef(f.id).kind !== 'rug') return i
    if (rugHit < 0) rugHit = i
  }
  return rugHit
}

/** Lấy món đồ trong túi ra đặt vào phòng. */
export function place(state: GameState, id: string, cx: number, cz: number, rot: number): boolean {
  if (!countItem(state.inventory, `furn_${id}`) || !canPlace(state, id, cx, cz, rot)) return false
  removeItem(state.inventory, `furn_${id}`, 1)
  state.house.furniture.push({ id, cx, cz, rot })
  bus.emit('progress', { type: 'place', amount: 1, id })
  bus.emit('saveRequest', undefined)
  return true
}

/** Cất món đồ đã đặt vào lại túi. */
export function pickUp(state: GameState, index: number): boolean {
  const f = state.house.furniture[index]
  if (!f) return false
  if (!canFit(state.inventory, `furn_${f.id}`, 1)) return fail('notice.bagFull')
  addItem(state.inventory, `furn_${f.id}`, 1)
  state.house.furniture.splice(index, 1)
  bus.emit('saveRequest', undefined)
  return true
}

/** Hình chữ nhật (toạ độ thế giới) của các món đồ chắn đường; thảm đi lên được. */
export function blockedRects(state: GameState): Rect[] {
  const c = roomCorner()
  return state.house.furniture
    .filter((f) => furnitureDef(f.id).kind !== 'rug')
    .map((f) => {
      const { w, d } = footprint(furnitureDef(f.id), f.rot)
      return { x0: c.x + f.cx, z0: c.z + f.cz, x1: c.x + f.cx + w, z1: c.z + f.cz + d }
    })
}

/** Tâm món đồ trong thế giới. */
export function furnitureCenter(f: PlacedFurniture): { x: number; z: number } {
  const c = roomCorner()
  const { w, d } = footprint(furnitureDef(f.id), f.rot)
  return { x: c.x + f.cx + w / 2, z: c.z + f.cz + d / 2 }
}

export function enterHouse(state: GameState): void {
  state.player.indoors = true
  state.player.pos[0] = ROOM_ENTRY.x
  state.player.pos[2] = ROOM_ENTRY.z
  state.player.rotY = Math.PI
  bus.emit('saveRequest', undefined)
}

export function exitHouse(state: GameState): void {
  state.player.indoors = false
  state.player.pos[0] = HOUSE_DOOR.x
  state.player.pos[2] = HOUSE_DOOR.z + 0.6
  state.player.rotY = 0
  bus.emit('saveRequest', undefined)
}

/** Đứng ở thảm cửa (giữa cạnh nam) thì ra ngoài. */
export function atRoomDoor(x: number, z: number): boolean {
  return Math.abs(x - ROOM.x) < 1 && z > ROOM.z + ROOM.d / 2 - 0.25
}

/** Ngủ: từ 18:00 tới trước 5:00 thì ngủ tới 6:00 sáng hôm sau (GDD mục 3.2). */
export function sleep(state: GameState): void {
  const m = state.clock.minuteOfDay
  if (m >= 5 * 60 && m < 18 * 60) {
    bus.emit('notify', { key: 'house.notSleepy' })
    return
  }
  const toMorning = m >= 18 * 60 ? 24 * 60 - m + 6 * 60 : 6 * 60 - m
  advanceClock(state, toMorning / GAME_MINUTES_PER_SECOND)
  bus.emit('notify', { key: 'house.slept', good: true })
}

/** Giá và cấp người chơi cần để nâng nhà lên cấp 2, 3, 4, 5. */
export const HOUSE_UPGRADES = [
  { price: 2000, level: 3 },
  { price: 5000, level: 5 },
  { price: 10000, level: 7 },
  { price: 20000, level: 9 },
]

/** Lần nâng cấp kế tiếp, null nếu nhà đã tối đa. */
export function nextHouseUpgrade(state: GameState): { price: number; level: number } | null {
  return HOUSE_UPGRADES[state.house.level - 1] ?? null
}

export function upgradeHouse(state: GameState): boolean {
  const next = nextHouseUpgrade(state)
  if (!next) return false
  if (state.player.level < next.level) return fail('notice.locked', { level: next.level })
  if (state.player.gold < next.price) return fail('notice.noGold')
  state.player.gold -= next.price
  state.house.level++
  setRoomSize(state.house.level)
  bus.emit('houseUpgraded', state.house.level)
  bus.emit('notify', { key: 'house.upgraded', params: { level: state.house.level, w: ROOM.w, d: ROOM.d }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

export function buyFurniture(state: GameState, id: string): boolean {
  const def = furnitureDef(id)
  if (state.player.level < def.level) return fail('notice.locked', { level: def.level })
  if (state.player.gold < def.price) return fail('notice.noGold')
  if (!canFit(state.inventory, `furn_${id}`, 1)) return fail('notice.bagFull')
  state.player.gold -= def.price
  addItem(state.inventory, `furn_${id}`, 1)
  bus.emit('notify', { key: 'house.bought', params: { item: `furn_${id}` }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}
