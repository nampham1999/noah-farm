import { bus } from '../core/events.ts'
import { mulberry32 } from '../core/random.ts'
import type { GameState } from '../core/state.ts'
import { FOREST_ZONE, OBSTACLES } from '../core/world.ts'
import { FORAGE, FORAGE_CONFIG, type ForageDef } from '../data/index.ts'
import { dayStamp } from './animals.ts'
import { addItem, canFit } from './inventory.ts'
import { gainXp } from './progress.ts'

/**
 * Hái lượm trong rừng phía bắc: mỗi ngày game có một lứa đồ rừng mới ở những chỗ cố định theo
 * ngày (hạt giống từ ngày), nên nhìn thấy gì thì hái được đúng chừng đó. Bước tới gần là nhặt.
 * Mỗi lần nhặt có chút xác suất gặp may (nhặt được túi vàng, hoặc thỏ rừng mách chỗ nhặt thêm).
 */

export interface ForageSpot {
  index: number
  x: number
  z: number
  def: ForageDef
}

const MIN_GAP = 2.2
const COIN_CHANCE = 0.06
const BUNNY_CHANCE = 0.05

let cache: { stamp: number; spots: ForageSpot[] } | null = null

/** Các điểm đồ rừng của ngày hiện tại (chưa trừ những chỗ đã hái). */
export function forageSpots(state: GameState): ForageSpot[] {
  const stamp = dayStamp(state.clock)
  if (cache?.stamp === stamp) return cache.spots
  const season = state.clock.season
  const pool = FORAGE.filter((f) => f.seasons.includes(season))
  const total = pool.reduce((a, f) => a + f.weight, 0)
  const rand = mulberry32(stamp * 7919 + 13)
  const z = FOREST_ZONE
  const spots: ForageSpot[] = []
  for (let tries = 0; spots.length < FORAGE_CONFIG.spawnCount && tries < 400; tries++) {
    const x = z.x0 + 1.5 + rand() * (z.x1 - z.x0 - 3)
    const pz = z.z0 + 1.5 + rand() * (z.z1 - z.z0 - 3.5)
    // Không đặt trong gốc cây và không sát nhau.
    if (OBSTACLES.some((o) => Math.hypot(o.x - x, o.z - pz) < o.r + 0.8)) continue
    if (spots.some((s) => Math.hypot(s.x - x, s.z - pz) < MIN_GAP)) continue
    let r = rand() * total
    let def = pool[pool.length - 1]
    for (const f of pool) {
      if ((r -= f.weight) < 0) {
        def = f
        break
      }
    }
    spots.push({ index: spots.length, x, z: pz, def })
  }
  cache = { stamp, spots }
  return spots
}

/** Các điểm còn lại chưa hái hôm nay. */
export function remainingSpots(state: GameState): ForageSpot[] {
  const stamp = dayStamp(state.clock)
  if (state.forage.stamp !== stamp) state.forage = { stamp, taken: [] }
  return forageSpots(state).filter((s) => !state.forage.taken.includes(s.index))
}

let bagWarnAt = 0

/** Nhặt đồ rừng ở gần vị trí (x, z); gọi mỗi khung hình khi đang ngoài trời. */
export function collectNearby(state: GameState, x: number, z: number): void {
  if (z > FOREST_ZONE.z1) return
  for (const s of remainingSpots(state)) {
    if (Math.hypot(s.x - x, s.z - z) > FORAGE_CONFIG.pickRadius) continue
    if (!canFit(state.inventory, s.def.id, 1)) {
      if (Date.now() - bagWarnAt > 3000) {
        bagWarnAt = Date.now()
        bus.emit('notify', { key: 'notice.bagFull' })
      }
      return
    }
    state.forage.taken.push(s.index)
    addItem(state.inventory, s.def.id, 1)
    state.stats.forage++
    gainXp(state, FORAGE_CONFIG.xp)
    bus.emit('notify', { key: 'forage.found', params: { item: s.def.id }, good: true })
    bus.emit('sfx', 'harvest')
    bus.emit('progress', { type: 'forage', amount: 1, id: s.def.id })
    luck(state, s)
    bus.emit('saveRequest', undefined)
    return
  }
}

function luck(state: GameState, s: ForageSpot): void {
  const r = Math.random()
  if (r < COIN_CHANCE) {
    const gold = 30 + Math.floor(Math.random() * 60)
    state.player.gold += gold
    bus.emit('notify', { key: 'forage.coins', params: { gold }, good: true })
  } else if (r < COIN_CHANCE + BUNNY_CHANCE && canFit(state.inventory, s.def.id, 1)) {
    addItem(state.inventory, s.def.id, 1)
    bus.emit('notify', { key: 'forage.bunny', params: { item: s.def.id }, good: true })
  }
}
