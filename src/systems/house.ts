import { bus } from '../core/events.ts'
import type { GameState, PlacedFurniture } from '../core/state.ts'
import { edgeBetween, edgesBetween, emptyPlan, hKey, parseEdge, roomCellsAt, ROOM_DEFAULTS, vKey, cellKey, type CellStyle, type HousePlan, type RoomType } from '../core/housePlan.ts'
import { ENTRY_X, HOUSE_DOOR, layoutOf, ROOM, ROOM_ENTRY, roomCorner, setRoomSize, stairLink, stairsOf } from '../core/world.ts'
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

/** Bản vẽ của một tầng (tầng chưa có bản vẽ thì trống). */
export function planOf(state: GameState, floor: number): HousePlan {
  return (state.house.plans[floor] ??= emptyPlan())
}

/** Hai ô giữa cạnh nam (ở tầng trệt) là lối ra cửa, không được đặt đồ hay dựng tường chắn. */
function doorCells(floor: number): { cx: number; cz: number }[] {
  return floor === 0 ? [{ cx: ENTRY_X - 1, cz: ROOM.d - 1 }, { cx: ENTRY_X, cz: ROOM.d - 1 }] : []
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

/** Ô giữ chỗ (cửa ra vào, cầu thang): không đặt đồ chắn, không dựng tường sát. */
function reservedCells(level: number, floor: number): { cx: number; cz: number }[] {
  return [...doorCells(floor), ...stairCells(level, floor)]
}

/** Hình chữ nhật chặn đường (toạ độ thế giới) của các đoạn tường (cửa thì để thông). */
export function wallRects(plan: HousePlan): Rect[] {
  const c = roomCorner()
  const out: Rect[] = []
  for (const [k, v] of Object.entries(plan.walls)) {
    if (v !== 1) continue
    const e = parseEdge(k, ROOM.w, ROOM.d)
    if (!e) continue
    out.push(
      e.axis === 'h'
        ? { x0: c.x + e.cx, x1: c.x + e.cx + 1, z0: c.z + e.cz - 0.1, z1: c.z + e.cz + 0.1 }
        : { x0: c.x + e.cx - 0.1, x1: c.x + e.cx + 0.1, z0: c.z + e.cz, z1: c.z + e.cz + 1 },
    )
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

/** Đặt được không (thuần): trong nhà, không chắn cửa / cầu thang, không bắc ngang tường hay cửa, không chồng lên đồ cùng lớp. */
function fitsOn(list: PlacedFurniture[], plan: HousePlan, level: number, floor: number, id: string, cx: number, cz: number, rot: number, ignore = -1): boolean {
  const rug = furnitureDef(id).kind === 'rug'
  const mine = cells(id, cx, cz, rot)
  if (mine.some((c) => c.cx < 0 || c.cz < 0 || c.cx >= ROOM.w || c.cz >= ROOM.d)) return false
  const reserved = reservedCells(level, floor)
  if (!rug && mine.some((c) => doorCells(floor).some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  if (mine.some((c) => stairCells(level, floor).some((d) => d.cx === c.cx && d.cz === c.cz))) return false
  void reserved
  // Thảm được trải ngang tường/cửa (lối đi), đồ khác thì không bắc ngang.
  if (!rug) {
    const has = (x: number, z: number) => mine.some((c) => c.cx === x && c.cz === z)
    for (const c of mine) {
      if (has(c.cx + 1, c.cz) && edgeBetween(plan, ROOM.w, ROOM.d, c.cx, c.cz, 'e') !== 0) return false
      if (has(c.cx, c.cz + 1) && edgeBetween(plan, ROOM.w, ROOM.d, c.cx, c.cz, 's') !== 0) return false
    }
  }
  return list.every((f, i) => {
    if (i === ignore || floorOf(f) !== floor || (furnitureDef(f.id).kind === 'rug') !== rug) return true
    const theirs = cells(f.id, f.cx, f.cz, f.rot)
    return !mine.some((a) => theirs.some((b) => a.cx === b.cx && a.cz === b.cz))
  })
}

export function canPlace(state: GameState, id: string, cx: number, cz: number, rot: number, ignore = -1): boolean {
  return fitsOn(state.house.furniture, planOf(state, state.player.floor), state.house.level, state.player.floor, id, cx, cz, rot, ignore)
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
    ...wallRects(planOf(state, state.player.floor)),
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
export function reconcileHouse(state: GameState): number {
  const layout = layoutOf(state.house.level)
  // Đủ bản vẽ cho mọi tầng (tầng mới còn trống).
  while (state.house.plans.length < layout.floors) state.house.plans.push(emptyPlan())
  const keep: PlacedFurniture[] = []
  let moved = 0
  for (const f of state.house.furniture) {
    const ok = floorOf(f) < layout.floors && fitsOn(keep, state.house.plans[floorOf(f)], state.house.level, floorOf(f), f.id, f.cx, f.cz, f.rot)
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

// ───────────── Thiết kế nhà: dựng tường, cửa, sơn phòng ─────────────

export const WALL_COST = 8
export const DOOR_COST = 40

/** Cạnh này có bị đồ nội thất đang đặt bắc ngang không (đã đặt đồ thì không dựng tường lên được). */
function edgeCrossedByFurniture(state: GameState, floor: number, key: string): boolean {
  const e = parseEdge(key, ROOM.w, ROOM.d)
  if (!e) return false
  // Hai ô kề nhau hai bên cạnh.
  const a = e.axis === 'h' ? { cx: e.cx, cz: e.cz - 1 } : { cx: e.cx - 1, cz: e.cz }
  const b = { cx: e.cx, cz: e.cz }
  return state.house.furniture.some((f) => {
    if (floorOf(f) !== floor || furnitureDef(f.id).kind === 'rug') return false
    const own = cells(f.id, f.cx, f.cz, f.rot)
    return own.some((c) => c.cx === a.cx && c.cz === a.cz) && own.some((c) => c.cx === b.cx && c.cz === b.cz)
  })
}

/** Cạnh sát ô giữ chỗ (cửa ra vào, cầu thang) thì không dựng được. */
function edgeBlocked(state: GameState, floor: number, key: string): boolean {
  const e = parseEdge(key, ROOM.w, ROOM.d)
  if (!e) return true
  const a = e.axis === 'h' ? { cx: e.cx, cz: e.cz - 1 } : { cx: e.cx - 1, cz: e.cz }
  const b = { cx: e.cx, cz: e.cz }
  return reservedCells(state.house.level, floor).some((r) => (r.cx === a.cx && r.cz === a.cz) || (r.cx === b.cx && r.cz === b.cz))
}

/** Dựng tường dọc theo đường thẳng từ đỉnh lưới a tới b; trả về số đoạn mới dựng. Hết vàng thì dựng tới đâu hay tới đó. */
export function buildWall(state: GameState, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const floor = state.player.floor
  const plan = planOf(state, floor)
  let built = 0
  let blocked = false
  for (const key of edgesBetween(a, b, ROOM.w, ROOM.d)) {
    if (plan.walls[key]) continue
    if (edgeBlocked(state, floor, key) || edgeCrossedByFurniture(state, floor, key)) {
      blocked = true
      continue
    }
    if (state.player.gold < WALL_COST) {
      bus.emit('notify', { key: 'notice.noGold' })
      break
    }
    state.player.gold -= WALL_COST
    plan.walls[key] = 1
    built++
  }
  if (blocked) bus.emit('notify', { key: 'house.wallBlocked' })
  if (built) {
    bus.emit('sfx', 'place')
    bus.emit('saveRequest', undefined)
  }
  return built
}

/** Đổi một đoạn tường thành cửa (mất DOOR_COST), hoặc cửa về lại tường. Không có tường ở đó thì không làm gì. */
export function toggleDoor(state: GameState, key: string): boolean {
  const plan = planOf(state, state.player.floor)
  const cur = plan.walls[key]
  if (!cur) return false
  if (cur === 1) {
    if (state.player.gold < DOOR_COST) return fail('notice.noGold')
    state.player.gold -= DOOR_COST
    plan.walls[key] = 2
  } else plan.walls[key] = 1
  bus.emit('sfx', 'place')
  bus.emit('saveRequest', undefined)
  return true
}

/** Phá một đoạn tường hoặc cửa, hoàn lại nửa tiền dựng tường. */
export function eraseWall(state: GameState, key: string): boolean {
  const plan = planOf(state, state.player.floor)
  if (!plan.walls[key]) return false
  delete plan.walls[key]
  state.player.gold += Math.floor(WALL_COST / 2)
  bus.emit('sfx', 'place')
  bus.emit('saveRequest', undefined)
  return true
}

/** Sơn cả phòng chứa ô (cx, cz): đổi loại phòng, sàn hoặc màu tường (chỉ các trường có trong patch). Trả về số ô đã đổi. */
export function paintRoom(state: GameState, cx: number, cz: number, patch: Partial<CellStyle>): number {
  const plan = planOf(state, state.player.floor)
  const cellsOfRoom = roomCellsAt(plan, ROOM.w, ROOM.d, cx, cz)
  for (const c of cellsOfRoom) {
    const k = cellKey(c.cx, c.cz)
    const next: CellStyle = { ...(plan.cells[k] ?? { t: 'living', f: 'plank', w: 'cream' }), ...patch }
    if (patch.t && !patch.f) next.f = ROOM_DEFAULTS[patch.t].f
    if (patch.t && !patch.w) next.w = ROOM_DEFAULTS[patch.t].w
    if (next.t === 'living' && next.f === 'plank' && next.w === 'cream') delete plan.cells[k]
    else plan.cells[k] = next
  }
  if (cellsOfRoom.length) {
    bus.emit('sfx', 'place')
    bus.emit('saveRequest', undefined)
  }
  return cellsOfRoom.length
}

/** Áp bố cục mẫu theo cấp nhà vào tầng đang đứng (thay tường, cửa và loại phòng; đồ vướng được cất về túi). */
export function applyPreset(state: GameState, preset: HousePlan): void {
  state.house.plans[state.player.floor] = JSON.parse(JSON.stringify(preset)) as HousePlan
  const moved = reconcileHouse(state)
  if (moved) bus.emit('notify', { key: 'house.movedBack', params: { n: moved } })
  bus.emit('saveRequest', undefined)
}

export type { RoomType }
void hKey
void vKey
