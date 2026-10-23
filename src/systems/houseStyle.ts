import { bus } from '../core/events.ts'
import { roomsOf, type RoomType } from '../core/housePlan.ts'
import type { GameState, PlacedFurniture } from '../core/state.ts'
import { ROOM, layoutOf } from '../core/world.ts'
import { FURNITURE_BY_ID, type FurnitureCat } from '../data/index.ts'
import { absDay } from './clock.ts'
import { gainXp } from './progress.ts'
import { realDay } from './checkin.ts'
import { planOf } from './house.ts'

/**
 * Điểm phong cách của nhà: mỗi phòng được chấm theo đồ hợp loại phòng, đồ trang trí và "đồ then chốt" (giường cho phòng ngủ,
 * bếp + tủ lạnh/bồn rửa cho bếp...). Phòng trống không có điểm. Điểm cao thì nhận vàng và XP mỗi ngày, và được khách khen.
 */

/** Đồ dùng để nấu ăn trong nhà (bếp phải nằm trong phòng loại "Bếp"). */
export const COOKER_IDS = new Set(['stove', 'oven', 'big_stove', 'k_kStove', 'k_kStoveElectric'])

/** Nhóm đồ hợp với từng loại phòng. */
const FIT: Record<RoomType, FurnitureCat[]> = {
  living: ['living'],
  bedroom: ['bedroom'],
  kitchen: ['kitchen'],
  bath: ['bath'],
  study: ['study'],
  dining: ['kitchen', 'living'],
}

const has = (items: PlacedFurniture[], test: (id: string) => boolean): boolean => items.some((f) => test(f.id))
const count = (items: PlacedFurniture[], test: (id: string) => boolean): number => items.filter((f) => test(f.id)).length
const isSeat = (id: string): boolean => /sofa|chair|armchair|lounge|bench|stool|pouf/i.test(id)
const isTable = (id: string): boolean => /table/i.test(id)

/** Phòng có đủ đồ then chốt theo loại phòng chưa. */
function anchors(type: RoomType, items: PlacedFurniture[]): boolean {
  switch (type) {
    case 'bedroom':
      return has(items, (id) => FURNITURE_BY_ID.get(id)?.kind === 'bed')
    case 'kitchen':
      return has(items, (id) => COOKER_IDS.has(id)) && has(items, (id) => /fridge|sink|basin/i.test(id))
    case 'bath':
      return has(items, (id) => /toilet/i.test(id)) && has(items, (id) => /basin|sink|bathtub|shower/i.test(id))
    case 'study':
      return has(items, (id) => /desk/i.test(id))
    case 'living':
      return has(items, isSeat) && has(items, isTable)
    case 'dining':
      return has(items, isTable) && count(items, (id) => /chair|stool/i.test(id)) >= 2
  }
}

export interface RoomScore {
  floor: number
  type: RoomType
  cells: number
  items: number
  score: number
  /** Đủ đồ then chốt. */
  complete: boolean
}

export interface HouseScore {
  rooms: RoomScore[]
  total: number
  /** 0..5 sao. */
  stars: number
}

const STAR_AT = [60, 150, 300, 500, 800]

export function houseScore(state: GameState): HouseScore {
  const layout = layoutOf(state.house.level)
  const rooms: RoomScore[] = []
  for (let floor = 0; floor < layout.floors; floor++) {
    const plan = planOf(state, floor)
    const onFloor = state.house.furniture.filter((f) => (f.fl ?? 0) === floor)
    for (const room of roomsOf(plan, ROOM.w, ROOM.d)) {
      const inRoom = onFloor.filter((f) => room.cells.some((c) => c.cx === f.cx && c.cz === f.cz))
      if (!inRoom.length) continue
      const fit = inRoom.filter((f) => FIT[room.type].includes(FURNITURE_BY_ID.get(f.id)?.cat ?? 'decor')).length
      const decor = inRoom.filter((f) => {
        const d = FURNITURE_BY_ID.get(f.id)
        return d && (d.cat === 'decor' || d.cat === 'wall' || d.kind === 'rug')
      }).length
      const complete = anchors(room.type, inRoom)
      const score = Math.min(fit, 8) * 12 + Math.min(decor, 6) * 6 + (complete ? 40 : 0) + (room.cells.length >= 6 ? 10 : 0)
      rooms.push({ floor, type: room.type, cells: room.cells.length, items: inRoom.length, score, complete })
    }
  }
  const total = rooms.reduce((s, r) => s + r.score, 0)
  return { rooms, total, stars: STAR_AT.filter((s) => total >= s).length }
}

/** Điểm của phòng chứa ô (cx, cz) ở một tầng; null nếu phòng không có đồ. */
export function roomScoreAt(state: GameState, floor: number, cx: number, cz: number): RoomScore | null {
  const plan = planOf(state, floor)
  const room = roomsOf(plan, ROOM.w, ROOM.d).find((r) => r.cells.some((c) => c.cx === cx && c.cz === cz))
  if (!room) return null
  return houseScore(state).rooms.find((r) => r.floor === floor && r.type === room.type && room.cells.length === r.cells && r.items > 0) ?? null
}

/** Loại phòng chứa ô (cx, cz) ở một tầng. */
export function roomTypeAt(state: GameState, floor: number, cx: number, cz: number): RoomType | null {
  const plan = planOf(state, floor)
  return roomsOf(plan, ROOM.w, ROOM.d).find((r) => r.cells.some((c) => c.cx === cx && c.cz === cz))?.type ?? null
}

const REWARD_GOLD_CAP = 1500

export interface HouseReward {
  score: number
  stars: number
  gold: number
  xp: number
  available: boolean
}

export function houseReward(state: GameState, at = Date.now()): HouseReward {
  const s = houseScore(state)
  return {
    score: s.total,
    stars: s.stars,
    gold: Math.min(REWARD_GOLD_CAP, Math.round(s.total * 0.5)),
    xp: Math.round(s.total / 8),
    available: s.total >= STAR_AT[0] && state.house.rewardDay !== realDay(at),
  }
}

/** Nhận thưởng nhà đẹp, mỗi ngày thật một lần. */
export function claimHouseReward(state: GameState, at = Date.now()): HouseReward | null {
  const r = houseReward(state, at)
  if (!r.available) return null
  state.house.rewardDay = realDay(at)
  state.player.gold += r.gold
  gainXp(state, r.xp)
  bus.emit('notify', { key: 'house.reward', params: { gold: r.gold, xp: r.xp }, good: true })
  bus.emit('sfx', 'coin')
  bus.emit('saveRequest', undefined)
  return r
}

/** Hôm nay (ngày game) có đang "ngủ ngon" không: thể lực tiêu hao ít hơn. */
export function isRested(state: GameState): boolean {
  return state.house.restedDay === absDay(state.clock)
}
