import { bus } from '../core/events.ts'
import type { AnimalState, GameState } from '../core/state.ts'
import { isWater } from '../core/world.ts'
import { animalPose, sendHome, setPose } from './animals.ts'

/** Cưỡi bò (GDD mục 3.3, phím R): chỉ bò đã thuần; khi cưỡi đi nhanh hơn. */
export const RIDE_SPEED = 1.8
const MOUNT_RANGE = 2

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

/** R / nút cưỡi: lên con bò gần nhất hoặc xuống bò. */
export function toggleRide(state: GameState): void {
  if (ridingId) return dismount(state)
  const cow = mountable(state)
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
      setPose(ridingId, pos[0], pos[2], rotY, 0)
      pos[0] = x
      pos[2] = z
      break
    }
  }
  sendHome(ridingId)
  ridingId = null
}

/** Mỗi khung hình: con bò đi theo nhân vật. */
export function updateRiding(state: GameState, speed01: number): void {
  if (!ridingId) return
  if (!state.animals.some((a) => a.id === ridingId)) {
    ridingId = null
    return
  }
  setPose(ridingId, state.player.pos[0], state.player.pos[2], state.player.rotY, speed01)
}
