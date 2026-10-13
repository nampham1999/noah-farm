import { bus } from '../core/events.ts'
import type { AnimalState, GameState } from '../core/state.ts'
import { isWater } from '../core/world.ts'
import { animalPose, sendHome, setPose } from './animals.ts'

/**
 * Cưỡi bò (GDD mục 3.3, phím R): chỉ bò đã thuần; khi cưỡi đi nhanh hơn.
 * Ngựa (mua ở cửa hàng) chạy nhanh hơn nữa; ở xa bấm cưỡi thì ngựa phi tới đón.
 */
export const RIDE_SPEED = 1.8
export const HORSE_SPEED = 2.5
export const HORSE_PRICE = 1500
export const HORSE_LEVEL = 3
/** Id dùng cho ngựa khi đang cưỡi (bò thì dùng id con bò). */
export const HORSE_ID = 'horse'
/** Cột buộc ngựa, cạnh chuồng. */
export const HITCH = { x: 7.6, z: -12.4 }
const MOUNT_RANGE = 2
const GALLOP = 9

export interface HorsePose {
  x: number
  z: number
  rotY: number
  speed01: number
}
const horse: HorsePose = { x: HITCH.x, z: HITCH.z, rotY: Math.PI, speed01: 0 }
let called = false

export function horsePose(): HorsePose {
  return horse
}

export function rideSpeed(): number {
  return ridingId === HORSE_ID ? HORSE_SPEED : RIDE_SPEED
}

export function buyHorse(state: GameState): boolean {
  if (state.horse) return false
  if (state.player.level < HORSE_LEVEL) return fail('notice.locked', { level: HORSE_LEVEL })
  if (state.player.gold < HORSE_PRICE) return fail('notice.noGold')
  state.player.gold -= HORSE_PRICE
  state.horse = true
  bus.emit('notify', { key: 'horse.bought', good: true })
  bus.emit('saveRequest', undefined)
  return true
}

function horseNear(state: GameState): boolean {
  return state.horse && Math.hypot(horse.x - state.player.pos[0], horse.z - state.player.pos[2]) < MOUNT_RANGE
}

function mountHorse(state: GameState): void {
  called = false
  ridingId = HORSE_ID
  state.player.pos[0] = horse.x
  state.player.pos[2] = horse.z
  state.player.rotY = horse.rotY
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}

let ridingId: string | null = null

export function ridingAnimal(): string | null {
  return ridingId
}

/** Bò đã thuần gần nhất trong tầm leo lên. */
export function mountable(state: GameState): AnimalState | null {
  const [px, , pz] = state.player.pos
  let best: AnimalState | null = null
  let bestD = MOUNT_RANGE
  for (const a of state.animals) {
    if (a.type !== 'cow' || !a.tamed) continue
    const p = animalPose(a.id)
    if (!p) continue
    const d = Math.hypot(p.x - px, p.z - pz)
    if (d < bestD) {
      best = a
      bestD = d
    }
  }
  return best
}

/** Có thể bấm cưỡi lúc này không (để hiện nút): có bò thuần gần, hoặc có ngựa. */
export function canRide(state: GameState): boolean {
  return state.horse || mountable(state) !== null
}

/** R / nút cưỡi: lên con bò gần nhất / ngựa, hoặc gọi ngựa tới; đang cưỡi thì xuống. */
export function toggleRide(state: GameState): void {
  if (ridingId) return dismount(state)
  if (horseNear(state)) return mountHorse(state)
  const cow = mountable(state)
  if (!cow && state.horse) {
    called = true
    bus.emit('notify', { key: 'horse.called' })
    bus.emit('sfx', 'horse')
    return
  }
  if (!cow) {
    const anyTamed = state.animals.some((a) => a.type === 'cow' && a.tamed)
    bus.emit('notify', { key: anyTamed ? 'ride.notNear' : 'ride.noTamedCow' })
    return
  }
  const p = animalPose(cow.id)!
  ridingId = cow.id
  state.player.pos[0] = p.x
  state.player.pos[2] = p.z
  state.player.rotY = p.rotY
}

export function dismount(state: GameState): void {
  if (!ridingId) return
  const { pos, rotY } = state.player
  // Bước xuống bên phải con bò, nếu chỗ đó là nước thì bên trái.
  for (const side of [1, -1]) {
    const x = pos[0] + Math.cos(rotY) * 0.9 * side
    const z = pos[2] - Math.sin(rotY) * 0.9 * side
    if (!isWater(x, z)) {
      if (ridingId !== HORSE_ID) setPose(ridingId, pos[0], pos[2], rotY, 0)
      pos[0] = x
      pos[2] = z
      break
    }
  }
  if (ridingId === HORSE_ID) {
    // Ngựa đứng lại chỗ vừa xuống (updateRiding đã giữ ngựa ở đó).
    horse.speed01 = 0
  } else {
    sendHome(ridingId)
  }
  ridingId = null
}

/** Mỗi khung hình: con vật đang cưỡi đi theo nhân vật; ngựa được gọi thì phi tới. */
export function updateRiding(state: GameState, speed01: number, dt = 0): void {
  if (!state.horse) called = false
  if (called && !ridingId) {
    const dx = state.player.pos[0] - horse.x
    const dz = state.player.pos[2] - horse.z
    const d = Math.hypot(dx, dz)
    if (state.player.indoors) called = false
    else if (d < 1.2) mountHorse(state)
    else {
      const step = Math.min(d, GALLOP * dt)
      horse.x += (dx / d) * step
      horse.z += (dz / d) * step
      horse.rotY = Math.atan2(dx, dz)
      horse.speed01 = 1
    }
  } else if (!ridingId) {
    horse.speed01 = 0
  }
  if (!ridingId) return
  if (ridingId === HORSE_ID) {
    horse.x = state.player.pos[0]
    horse.z = state.player.pos[2]
    horse.rotY = state.player.rotY
    horse.speed01 = speed01
    return
  }
  if (!state.animals.some((a) => a.id === ridingId)) {
    ridingId = null
    return
  }
  setPose(ridingId, state.player.pos[0], state.player.pos[2], state.player.rotY, speed01)
}
