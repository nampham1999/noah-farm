import { bus } from '../core/events.ts'
import type { GameState, PlayerState } from '../core/state.ts'
import { HOUSE_DOOR } from '../core/world.ts'
import { CROPS } from '../data/index.ts'
import { dayStamp } from './animals.ts'
import { addItem, canFit } from './inventory.ts'
import { movePlayer } from './movement.ts'
import { gainXp } from './progress.ts'

/**
 * Chó nuôi: đi theo sau người chơi, người chơi vào nhà thì ngồi chờ ở cửa.
 * Vuốt ve mỗi ngày một lần; mỗi sáng hay đánh hơi được một món quà nhỏ.
 */

export const PET_PRICE = 250
const FOLLOW_GAP = 1.6
/** Xa hơn chừng này (lạc sau rào...) thì chạy vụt tới cạnh người chơi. */
const TELEPORT_DIST = 9
const GIFT_CHANCE = 0.7
const PET_XP = 2

export interface PetPose {
  x: number
  z: number
  rotY: number
  speed01: number
  /** Đứng yên đủ lâu thì ngồi. */
  sitting: boolean
}

// Vị trí chó chỉ để hiển thị, không lưu: tải lại thì xuất hiện cạnh người chơi.
const body = { pos: [0, 0, 0] as [number, number, number], rotY: 0, indoors: false } as PlayerState
let placed = false
let idleFor = 0
const pose: PetPose = { x: 0, z: 0, rotY: 0, speed01: 0, sitting: false }

export function petPose(): PetPose {
  return pose
}

export function buyPet(state: GameState): boolean {
  if (state.pet) return false
  if (state.player.gold < PET_PRICE) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  state.player.gold -= PET_PRICE
  state.pet = { name: 'Lu', pettedDay: -1, gift: null }
  placed = false
  bus.emit('notify', { key: 'pet.adopted', params: { name: state.pet.name }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

export function updatePet(state: GameState, dt: number): void {
  if (!state.pet) return
  const p = state.player
  // Người chơi trong nhà: chó ngồi chờ trước cửa.
  const tx = p.indoors ? HOUSE_DOOR.x + 1 : p.pos[0] - Math.sin(p.rotY) * FOLLOW_GAP
  const tz = p.indoors ? HOUSE_DOOR.z + 0.8 : p.pos[2] - Math.cos(p.rotY) * FOLLOW_GAP
  if (!placed || Math.hypot(tx - body.pos[0], tz - body.pos[2]) > TELEPORT_DIST) {
    body.pos[0] = tx
    body.pos[2] = tz
    placed = true
  }
  const dx = tx - body.pos[0]
  const dz = tz - body.pos[2]
  const dist = Math.hypot(dx, dz)
  let speed = 0
  if (dist > 0.6) {
    // Xa thì chạy nhanh hơn người một chút để bắt kịp.
    const mul = Math.min(1.35, 0.5 + dist * 0.35)
    speed = movePlayer(body, { x: dx / dist, z: dz / dist }, mul, dt)
  } else if (!p.indoors) {
    // Đứng cạnh thì quay về phía người chơi.
    const want = Math.atan2(p.pos[0] - body.pos[0], p.pos[2] - body.pos[2])
    body.rotY += Math.atan2(Math.sin(want - body.rotY), Math.cos(want - body.rotY)) * Math.min(1, dt * 4)
  }
  idleFor = speed > 0.2 ? 0 : idleFor + dt
  pose.x = body.pos[0]
  pose.z = body.pos[2]
  pose.rotY = body.rotY
  pose.speed01 = Math.min(1, speed / 4)
  pose.sitting = idleFor > 2
}

/** Sáng ngày mới: chó hay tìm được quà (hạt giống đúng mùa, cỏ khô, trứng hoặc vài đồng). */
export function petNewDay(state: GameState): void {
  if (!state.pet || state.pet.gift || Math.random() > GIFT_CHANCE) return
  const seasonal = CROPS.filter((c) => c.seasons.includes(state.clock.season) && c.level <= state.player.level)
  const options: { id: string; qty: number }[] = [
    { id: 'gold', qty: 20 + Math.floor(Math.random() * 41) },
    { id: 'feed_hay', qty: 5 },
    { id: 'egg', qty: 1 },
    ...seasonal.map((c) => ({ id: `seed_${c.id}`, qty: 3 })),
  ]
  state.pet.gift = options[Math.floor(Math.random() * options.length)]
}

/** Chạm vào chó: lấy quà nếu có, rồi vuốt ve (mỗi ngày một lần được XP). */
export function actOnPet(state: GameState): void {
  const pet = state.pet
  if (!pet) return
  if (pet.gift) {
    const { id, qty } = pet.gift
    if (id === 'gold') {
      state.player.gold += qty
      pet.gift = null
      bus.emit('notify', { key: 'pet.giftGold', params: { name: pet.name, qty }, good: true })
    } else if (canFit(state.inventory, id, qty)) {
      addItem(state.inventory, id, qty)
      pet.gift = null
      bus.emit('notify', { key: 'pet.gift', params: { name: pet.name, item: id, qty }, good: true })
    } else {
      bus.emit('notify', { key: 'notice.bagFull' })
    }
    bus.emit('saveRequest', undefined)
    return
  }
  const today = dayStamp(state.clock)
  bus.emit('sfx', 'dog')
  if (pet.pettedDay === today) {
    bus.emit('notify', { key: 'pet.happy', params: { name: pet.name } })
    return
  }
  pet.pettedDay = today
  gainXp(state, PET_XP)
  bus.emit('notify', { key: 'pet.petted', params: { name: pet.name }, good: true })
  bus.emit('saveRequest', undefined)
}

export function petIsPettedToday(state: GameState): boolean {
  return state.pet?.pettedDay === dayStamp(state.clock)
}
