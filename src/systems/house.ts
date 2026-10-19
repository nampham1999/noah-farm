import { bus } from '../core/events.ts'
import type { GameState, PlacedFurniture } from '../core/state.ts'
import { HOUSE_DOOR, layoutOf, MAIN_W, NORTH_D, ROOM, ROOM_ENTRY, roomCorner, setRoomSize, solidRanges, stairLink, stairsOf } from '../core/world.ts'
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

const floorOf = (f: PlacedFurniture): number => f.fl ?? 0

/** Đồ đặt ở tầng đang đứng. */
function onFloor(state: GameState, f: PlacedFurniture): boolean {
  return floorOf(f) === state.player.floor
}

/** Số tầng của nhà theo cấp. */
export function floorCount(state: GameState): number {
  return layoutOf(state.house.level).floors
}

/** Hai ô giữa cạnh nam của phòng chính là lối ra cửa (chỉ ở tầng trệt), không được đặt đồ chắn. */
function doorCells(floor: number): { cx: number; cz: number }[] {
  return floor === 0 ? [{ cx: MAIN_W / 2 - 1, cz: ROOM.d - 1 }, { cx: MAIN_W / 2, cz: ROOM.d - 1 }] : []
}

/** Các ô cầu thang có ở tầng này (lên nếu còn tầng trên, xuống nếu không phải tầng trệt). */
function stairCells(level: number, floor: number): { cx: number; cz: number }[] {
  const out: { cx: number; cz: number }[] = []
  const add = (s: { cx: number; cz: number; w: number; d: number }) => {
    for (let i = 0; i < s.w; i++) for (let j = 0; j < s.d; j++) out.push({ cx: s.cx + i, cz: s.cz + j })
  }
  const st = stairsOf(level, floor)
  if (st.up) add(st.up)
  if (st.down) add(st.down)
  return out
}

/** Ô của đồ cố định (bếp, nhà vệ sinh): chỉ ở tầng trệt. */
function fixtureCells(level: number, floor: number): { cx: number; cz: number }[] {
  if (floor !== 0) return []
  return layoutOf(level).fixtures.flatMap((f) => Array.from({ length: f.w * f.d }, (_, i) => ({ cx: f.cx + (i % f.w), cz: f.cz + Math.floor(i / f.w) })))
}

/** Hình chữ nhật chặn đường (toạ độ thế giới): vách đặc (chừa lối đi) và đồ cố định. */
export function wallRects(level: number, floor: number): Rect[] {
  const c = roomCorner()
  const layout = layoutOf(level)
  const out: Rect[] = []
  for (const w of layout.walls) {
    for (const [a, b] of solidRanges(w)) {
      out.push(
        w.axis === 'z'
          ? { x0: c.x + w.at - 0.1, x1: c.x + w.at + 0.1, z0: c.z + a, z1: c.z + b }
          : { x0: c.x + a, x1: c.x + b, z0: c.z + w.at - 0.1, z1: c.z + w.at + 0.1 },
      )
    }
  }
  if (floor === 0) {
    for (const f of layout.fixtures) out.push({ x0: c.x + f.cx, x1: c.x + f.cx + f.w, z0: c.z + f.cz, z1: c.z + f.cz + f.d })
  }
  return out
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

/** Đặt được không (thuần): trong tầng, không chắn cửa / cầu thang, không bắc ngang vách ngăn, không chồng lên đồ cùng lớp. */
function fitsOn(list: PlacedFurniture[], level: number, floor: number, id: string, cx: number, cz: number, rot: number, ignore = -1): boolean {
  const rug = furnitureDef(id).kind === 'rug'
  const mine = cells(id, cx, cz, rot)
  if (mine.some((c) => c.cx < 0 || c.cz < 0 || c.cx >= ROOM.w || c.cz >= ROOM.d)) return false
  if (!rug && mine.some((c) => doorCells(floor).some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  if (mine.some((c) => stairCells(level, floor).some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  if (mine.some((c) => fixtureCells(level, floor).some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  // Thảm được trải ngang vách (lối đi), đồ khác thì không bắc ngang vách.
  if (!rug) {
    for (const w of layoutOf(level).walls) {
      const inRange = (v: number) => v >= w.from && v < w.to
      const cross = w.axis === 'z'
        ? mine.some((c) => inRange(c.cz)) && mine.some((c) => c.cx < w.at) && mine.some((c) => c.cx >= w.at)
        : mine.some((c) => inRange(c.cx)) && mine.some((c) => c.cz < w.at) && mine.some((c) => c.cz >= w.at)
      if (cross) return false
    }
  }
  return list.every((f, i) => {
    if (i === ignore || floorOf(f) !== floor || (furnitureDef(f.id).kind === 'rug') !== rug) return true
    const theirs = cells(f.id, f.cx, f.cz, f.rot)
    return !mine.some((a) => theirs.some((b) => a.cx === b.cx && a.cz === b.cz))
  })
}

export function canPlace(state: GameState, id: string, cx: number, cz: number, rot: number, ignore = -1): boolean {
  return fitsOn(state.house.furniture, state.house.level, state.player.floor, id, cx, cz, rot, ignore)
}

/** Món đồ ở ô (cx, cz); ưu tiên đồ đặt trên thảm. -1 nếu trống. */
export function furnitureAt(state: GameState, cx: number, cz: number): number {
  let rugHit = -1
  for (let i = state.house.furniture.length - 1; i >= 0; i--) {
    const f = state.house.furniture[i]
    if (!onFloor(state, f)) continue
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
  state.house.furniture.push({ id, cx, cz, rot, ...(state.player.floor > 0 ? { fl: state.player.floor } : {}) })
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
  return [
    ...state.house.furniture
      .filter((f) => onFloor(state, f) && furnitureDef(f.id).kind !== 'rug')
      .map((f) => {
        const { w, d } = footprint(furnitureDef(f.id), f.rot)
        return { x0: c.x + f.cx, z0: c.z + f.cz, x1: c.x + f.cx + w, z1: c.z + f.cz + d }
      }),
    ...wallRects(state.house.level, state.player.floor),
  ]
}

/** Tâm món đồ trong thế giới. */
export function furnitureCenter(f: PlacedFurniture): { x: number; z: number } {
  const c = roomCorner()
  const { w, d } = footprint(furnitureDef(f.id), f.rot)
  return { x: c.x + f.cx + w / 2, z: c.z + f.cz + d / 2 }
}

export function enterHouse(state: GameState): void {
  state.player.indoors = true
  state.player.floor = 0
  state.player.pos[0] = ROOM_ENTRY.x
  state.player.pos[2] = ROOM_ENTRY.z
  state.player.rotY = Math.PI
  bus.emit('saveRequest', undefined)
}

export function exitHouse(state: GameState): void {
  state.player.indoors = false
  state.player.floor = 0
  state.player.pos[0] = HOUSE_DOOR.x
  state.player.pos[2] = HOUSE_DOOR.z + 0.6
  state.player.rotY = 0
  bus.emit('saveRequest', undefined)
}

/** Đứng ở thảm cửa (giữa cạnh nam phòng chính, tầng trệt) thì ra ngoài. */
export function atRoomDoor(x: number, z: number, floor = 0): boolean {
  return floor === 0 && Math.abs(x - ROOM_ENTRY.x) < 1 && z > ROOM.z + ROOM.d / 2 - 0.25
}

function stairRect(s: { cx: number; cz: number; w: number; d: number }): Rect {
  const c = roomCorner()
  return { x0: c.x + s.cx, z0: c.z + s.cz, x1: c.x + s.cx + s.w, z1: c.z + s.cz + s.d }
}

/** Độ cao cầu thang (m): lên thì nhân vật nhích dần lên, xuống thì chìm dần xuống lỗ cầu thang. */
export const STAIR_H = 1.5

/**
 * Nhân vật đang ở đâu trên dốc cầu thang: t từ 0 (mép nam, chỗ bước vào) tới 1 (mép bắc, đỉnh / đáy cầu thang).
 * Đi dọc dốc thì độ cao đổi dần; tới đầu bắc thì game chuyển tầng.
 */
export function stairProgress(state: GameState): { dir: 'up' | 'down'; t: number } | null {
  const [x, , z] = state.player.pos
  const st = stairsOf(state.house.level, state.player.floor)
  const test = (s: { cx: number; cz: number; w: number; d: number } | null): number | null => {
    if (!s) return null
    const r = stairRect(s)
    if (x < r.x0 + 0.1 || x > r.x1 - 0.1 || z < r.z0 || z > r.z1) return null
    return Math.max(0, Math.min(1, (r.z1 - z) / (r.z1 - r.z0)))
  }
  const up = test(st.up)
  if (up !== null) return { dir: 'up', t: up }
  const down = test(st.down)
  return down !== null ? { dir: 'down', t: down } : null
}

/** Tới t này thì coi như đã lên tới đỉnh (nhân vật dừng cách vách phía bắc một chút nên không bao giờ tới đúng t = 1). */
export const STAIR_TOP = 0.78

export function stairHeight(p: { dir: 'up' | 'down'; t: number }): number {
  return (p.dir === 'up' ? 1 : -1) * STAIR_H * Math.min(1, p.t / STAIR_TOP)
}

/** Đi lên / xuống một tầng: đứng ngay trước chỗ nối cầu thang ở tầng mới (cùng một đầu nhà). */
export function changeFloor(state: GameState, dir: 'up' | 'down'): void {
  const c = roomCorner()
  const from = state.player.floor
  const link = stairLink(state.house.level, dir === 'up' ? from : from - 1)
  state.player.floor += dir === 'up' ? 1 : -1
  state.player.pos[0] = c.x + link.cx + link.w / 2
  state.player.pos[2] = c.z + link.cz + link.d + 1.8
  state.player.rotY = 0
  bus.emit('sfx', 'click')
  bus.emit('notify', { key: 'house.floor', params: { n: state.player.floor + 1 }, good: true })
  bus.emit('saveRequest', undefined)
}

/**
 * Sau khi nhà đổi bố cục (nâng cấp, hoặc bản lưu từ trước khi có phòng phụ và cầu thang): đồ nằm ngoài tầng, đè cầu thang,
 * chắn cửa hoặc bắc ngang vách ngăn thì cất lại vào túi. Trả về số món đã cất.
 */
/** Nhà từ cấp 3 có thêm dãy phía bắc: đồ đã đặt dịch xuống NORTH_D hàng một lần (ô tính từ góc tây bắc). */
export function ensureNorthShift(state: GameState): void {
  if (state.house.level < 3 || state.house.shifted) return
  for (const f of state.house.furniture) f.cz += NORTH_D
  state.house.shifted = true
}

export function reconcileHouse(state: GameState): number {
  ensureNorthShift(state)
  const layout = layoutOf(state.house.level)
  const keep: PlacedFurniture[] = []
  let moved = 0
  for (const f of state.house.furniture) {
    const ok = floorOf(f) < layout.floors && fitsOn(keep, state.house.level, floorOf(f), f.id, f.cx, f.cz, f.rot)
    if (ok || !canFit(state.inventory, `furn_${f.id}`, 1)) keep.push(f)
    else {
      addItem(state.inventory, `furn_${f.id}`, 1)
      moved++
    }
  }
  state.house.furniture = keep
  if (state.player.floor >= layout.floors) state.player.floor = 0
  return moved
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
  const moved = reconcileHouse(state)
  if (moved) bus.emit('notify', { key: 'house.movedBack', params: { n: moved } })
  bus.emit('houseUpgraded', state.house.level)
  bus.emit('notify', { key: 'house.upgraded', params: { level: state.house.level, w: ROOM.w, d: ROOM.d }, good: true })
  bus.emit('notify', { key: `house.feature.${state.house.level}`, good: true })
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
