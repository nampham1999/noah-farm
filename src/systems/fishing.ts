import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { FISH, type FishDef } from '../data/index.ts'
import { addItem, canFit, countItem } from './inventory.ts'
import { gainXp, useStamina } from './progress.ts'

/**
 * Câu cá (GDD mục 3.4): thả cần, chờ phao chìm, chạm trong 1 giây; rồi mini-game kéo cá:
 * giữ để nâng vùng xanh, giữ con cá trong vùng xanh cho đầy thanh. Cá theo mùa và giờ.
 */

export type FishingPhase = 'idle' | 'waiting' | 'bite' | 'reeling'

export interface Fishing {
  phase: FishingPhase
  /** Điểm phao trên mặt nước. */
  x: number
  z: number
  /** Giây còn lại của bước hiện tại (chờ cá cắn, cửa sổ 1 giây khi cá cắn). */
  timer: number
  fish: FishDef | null
  /** Mini-game: vị trí đáy vùng xanh và con cá (0..1 từ dưới lên), vận tốc vùng xanh, tiến độ. */
  zoneY: number
  zoneV: number
  fishY: number
  fishTarget: number
  fishRetarget: number
  progress: number
  /** Đang giữ tay (chuột, ngón, Space) để nâng vùng xanh. */
  holding: boolean
}

const STAMINA_PER_CAST = 2
const BITE_WINDOW = 1
const ZONE_LIFT = 3.2
const ZONE_GRAVITY = 2.6
const FILL_RATE = 0.32
const DRAIN_RATE = 0.22

export const fishing: Fishing = {
  phase: 'idle', x: 0, z: 0, timer: 0, fish: null,
  zoneY: 0, zoneV: 0, fishY: 0.5, fishTarget: 0.5, fishRetarget: 0, progress: 0, holding: false,
}

export function isFishing(): boolean {
  return fishing.phase !== 'idle'
}

/** Các loài đang có theo mùa, giờ và cấp người chơi. */
export function availableFish(state: GameState): FishDef[] {
  const hour = state.clock.minuteOfDay / 60
  return FISH.filter((f) => {
    if (f.level > state.player.level) return false
    if (f.seasons.length > 0 && !f.seasons.includes(state.clock.season)) return false
    if (!f.hours) return true
    const [from, to] = f.hours
    return from < to ? hour >= from && hour < to : hour >= from || hour < to
  })
}

function pickFish(state: GameState): FishDef {
  const pool = availableFish(state)
  let r = Math.random() * pool.reduce((sum, f) => sum + f.weight, 0)
  for (const f of pool) {
    r -= f.weight
    if (r <= 0) return f
  }
  return pool[0]
}

/** Thả cần xuống điểm (x, z) trên mặt nước. */
export function cast(state: GameState, x: number, z: number): boolean {
  if (isFishing()) return false
  if (!countItem(state.inventory, 'tool_fishing_rod')) return fail('fish.needRod')
  useStamina(state, STAMINA_PER_CAST)
  Object.assign(fishing, { phase: 'waiting', x, z, timer: 2 + Math.random() * 4, fish: null, holding: false })
  return true
}

/** Chạm khi đang câu: đúng lúc cá cắn thì bắt đầu kéo, sớm hay muộn đều trượt. */
export function strike(state: GameState): void {
  if (fishing.phase === 'waiting') {
    stop()
    bus.emit('notify', { key: 'fish.tooEarly' })
  } else if (fishing.phase === 'bite') {
    const fish = pickFish(state)
    Object.assign(fishing, {
      phase: 'reeling', fish, zoneY: 0.3, zoneV: 0, fishY: 0.45, fishTarget: 0.5, fishRetarget: 0, progress: 0.3,
    })
  }
}

export function stop(): void {
  fishing.phase = 'idle'
  fishing.fish = null
  fishing.holding = false
}

export function updateFishing(state: GameState, dt: number): void {
  const f = fishing
  if (f.phase === 'waiting') {
    f.timer -= dt
    if (f.timer <= 0) {
      f.phase = 'bite'
      f.timer = BITE_WINDOW
    }
  } else if (f.phase === 'bite') {
    f.timer -= dt
    if (f.timer <= 0) {
      stop()
      bus.emit('notify', { key: 'fish.missed' })
    }
  } else if (f.phase === 'reeling' && f.fish) {
    const zone = f.fish.zone
    // Vùng xanh: giữ thì bay lên, thả thì rơi, chạm đáy hoặc đỉnh thì dừng.
    f.zoneV += (f.holding ? ZONE_LIFT : -ZONE_GRAVITY) * dt
    f.zoneV *= Math.pow(0.15, dt)
    f.zoneY += f.zoneV * dt
    if (f.zoneY < 0 || f.zoneY > 1 - zone) {
      f.zoneY = Math.min(1 - zone, Math.max(0, f.zoneY))
      f.zoneV = 0
    }
    // Cá chọn điểm mới liên tục; cá hiếm đổi hướng nhanh và chạy xa hơn.
    f.fishRetarget -= dt
    if (f.fishRetarget <= 0) {
      f.fishTarget = Math.random() * 0.9 + 0.05
      f.fishRetarget = (0.6 + Math.random()) / f.fish.speed
    }
    f.fishY += (f.fishTarget - f.fishY) * Math.min(1, dt * 2 * f.fish.speed)

    const inside = f.fishY >= f.zoneY && f.fishY <= f.zoneY + zone
    f.progress += (inside ? FILL_RATE : -DRAIN_RATE) * dt
    if (f.progress >= 1) land(state, f.fish)
    else if (f.progress <= 0) {
      stop()
      bus.emit('notify', { key: 'fish.escaped' })
    }
  }
}

function land(state: GameState, fish: FishDef): void {
  stop()
  const id = `fish_${fish.id}`
  if (!canFit(state.inventory, id, 1)) {
    bus.emit('notify', { key: 'notice.bagFull' })
    return
  }
  addItem(state.inventory, id, 1)
  const first = !state.journal.fish[fish.id]
  state.journal.fish[fish.id] = (state.journal.fish[fish.id] ?? 0) + 1
  gainXp(state, fish.xp)
  bus.emit('progress', { type: 'fish', amount: 1, id: fish.id })
  bus.emit('notify', { key: first ? 'fish.caughtNew' : 'fish.caught', params: { item: id, xp: fish.xp }, good: true })
  bus.emit('saveRequest', undefined)
}

function fail(key: string): false {
  bus.emit('notify', { key })
  return false
}
