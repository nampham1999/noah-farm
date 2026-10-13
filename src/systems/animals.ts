import { bus } from '../core/events.ts'
import type { AnimalState, ClockState, GameState } from '../core/state.ts'
import { COOP, isWater, PEN } from '../core/world.ts'
import { ANIMAL_BY_ID, animalData, DAY_MS, type AnimalDef, type AnimalType } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem } from './inventory.ts'
import { gainXp } from './progress.ts'
import { SEASONS } from './clock.ts'

/**
 * Vật nuôi (GDD mục 3.3): cho ăn thì no trong 1 ngày game, lúc no thì "làm việc" ra sản phẩm
 * theo chu kỳ; bỏ đói thì ngừng sản xuất nhưng không chết. Tính theo dấu thời gian nên
 * vẫn chạy khi đóng tab (GDD mục 6.4).
 */

const FULL_MS = animalData.fullDays * DAY_MS

export function animalDef(a: AnimalState): AnimalDef {
  return ANIMAL_BY_ID.get(a.type)!
}

function cycleMs(a: AnimalState): number {
  return animalDef(a).cycleDays * DAY_MS
}

/** Số ngày game tuyệt đối, để biết hôm nay đã vuốt ve chưa. */
export function dayStamp(c: ClockState): number {
  return (c.year * SEASONS.length + SEASONS.indexOf(c.season)) * 100 + c.day
}

export function fullness(a: AnimalState, t: number): number {
  if (a.fedAt === null) return 0
  return Math.max(0, 1 - (t - a.fedAt) / FULL_MS)
}

export function isHungry(a: AnimalState, t: number): boolean {
  return fullness(a, t) <= 0
}

export function isReady(a: AnimalState): boolean {
  return a.progress >= cycleMs(a)
}

export function coopCapacity(state: GameState): number {
  return state.coopLevel === 0 ? 0 : animalData.coopLevels[state.coopLevel - 1].capacity
}

/** Cộng thời gian "làm việc" trong khoảng [prevT, t] mà con vật còn no. */
export function updateAnimals(state: GameState, t: number, prevT: number): void {
  for (const a of state.animals) {
    if (a.fedAt === null || isReady(a)) continue
    const from = Math.max(prevT, a.fedAt)
    const to = Math.min(t, a.fedAt + FULL_MS)
    if (to > from) a.progress = Math.min(cycleMs(a), a.progress + (to - from))
  }
}

/** Sang ngày mới: con nào đang đói thì buồn đi. */
export function animalsNewDay(state: GameState, t: number): void {
  for (const a of state.animals) {
    if (isHungry(a, t)) a.happiness = Math.max(0, a.happiness - animalData.hungryHappinessLossPerDay)
  }
}

/** Chạm vào con vật: nhặt sản phẩm, hoặc cho ăn, hoặc vuốt ve (theo thứ tự đó). */
export function actOnAnimal(state: GameState, a: AnimalState, t: number): boolean {
  const def = animalDef(a)
  if (isReady(a)) {
    const qty = a.happiness >= animalData.happyBonusAt ? 2 : 1
    if (!canFit(state.inventory, def.product, qty)) return fail('notice.bagFull')
    addItem(state.inventory, def.product, qty)
    a.progress = 0
    gainXp(state, def.xp)
    bus.emit('progress', { type: 'collect', amount: qty })
    bus.emit('notify', { key: 'animal.collected', params: { qty, item: def.product, xp: def.xp }, good: true })
    return true
  }
  // Con vật kêu khi được chăm.
  bus.emit('sfx', a.type)
  if (isHungry(a, t)) {
    if (!countItem(state.inventory, 'feed_hay')) return fail('animal.needHay')
    removeItem(state.inventory, 'feed_hay', 1)
    a.fedAt = t
    a.happiness = Math.min(100, a.happiness + animalData.feedHappiness)
    bus.emit('notify', { key: 'animal.fed', params: { name: a.name }, good: true })
    checkTamed(a)
    return true
  }
  const today = dayStamp(state.clock)
  if (a.pettedDay !== today) {
    a.pettedDay = today
    a.happiness = Math.min(100, a.happiness + animalData.petHappiness)
    bus.emit('notify', { key: 'animal.petted', params: { name: a.name, happy: Math.round(a.happiness) }, good: true })
    checkTamed(a)
    return true
  }
  const minutes = Math.ceil((cycleMs(a) - a.progress) / 60_000)
  bus.emit('notify', { key: 'animal.content', params: { name: a.name, item: def.product, minutes } })
  return false
}

/** Bò vui đạt 100 lần đầu thì thuần, từ đó cưỡi được (GDD mục 3.3). */
function checkTamed(a: AnimalState): void {
  if (a.type !== 'cow' || a.tamed || a.happiness < 100) return
  a.tamed = true
  bus.emit('notify', { key: 'ride.tamed', params: { name: a.name }, good: true })
}

export function buyCoopLevel(state: GameState): boolean {
  const next = animalData.coopLevels[state.coopLevel]
  if (!next) return false
  if (state.player.level < next.level) return fail('notice.locked', { level: next.level })
  if (state.player.gold < next.price) return fail('notice.noGold')
  state.player.gold -= next.price
  state.coopLevel++
  bus.emit('progress', { type: 'coop', amount: 1 })
  bus.emit('notify', { key: state.coopLevel === 1 ? 'animal.coopBuilt' : 'animal.coopUpgraded', params: { n: coopCapacity(state) }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

export function buyAnimal(state: GameState, type: AnimalType, t: number): boolean {
  const def = ANIMAL_BY_ID.get(type)!
  if (state.coopLevel === 0) return fail('animal.needCoop')
  if (state.animals.length >= coopCapacity(state)) return fail('animal.coopFull')
  if (state.player.level < def.level) return fail('notice.locked', { level: def.level })
  if (state.player.gold < def.price) return fail('notice.noGold')
  state.player.gold -= def.price
  const used = new Set(state.animals.map((a) => a.name))
  const name = animalData.names.find((n) => !used.has(n)) ?? `${def.icon}${state.animals.length + 1}`
  // Con mới về được cho ăn sẵn một bữa.
  state.animals.push({ id: `a${t.toString(36)}`, type, name, fedAt: t, progress: 0, happiness: 50, pettedDay: -1, tamed: false })
  bus.emit('notify', { key: 'animal.bought', params: { name, animal: `animal.${type}` }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/* ---------- Đi lại quanh chuồng (chỉ để hiển thị, không lưu) ---------- */

export interface AnimalPose {
  x: number
  z: number
  rotY: number
  /** 0..1, để hoạt ảnh bước chân. */
  speed01: number
  tx: number
  tz: number
  wait: number
}

const poses = new Map<string, AnimalPose>()
const WALK = 0.7

export function animalPose(id: string): AnimalPose | undefined {
  return poses.get(id)
}

function randomPenPoint(): { x: number; z: number } {
  for (;;) {
    const a = Math.random() * Math.PI * 2
    const d = Math.sqrt(Math.random()) * PEN.r
    const x = PEN.x + Math.cos(a) * d
    const z = PEN.z + Math.sin(a) * d
    if (Math.hypot(x - COOP.x, z - COOP.z) > COOP.r + 0.5 && !isWater(x, z, 0.5)) return { x, z }
  }
}

/** Mỗi con chọn một điểm trong bãi thả, đi tới, đứng nghỉ một lúc rồi chọn điểm khác. */
export function updateWander(state: GameState, dt: number, riddenId: string | null = null): void {
  for (const a of state.animals) {
    if (a.id === riddenId) continue
    let p = poses.get(a.id)
    if (!p) {
      const s = randomPenPoint()
      p = { x: s.x, z: s.z, rotY: Math.random() * Math.PI * 2, speed01: 0, tx: s.x, tz: s.z, wait: Math.random() * 3 }
      poses.set(a.id, p)
    }
    const dx = p.tx - p.x
    const dz = p.tz - p.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.1) {
      p.speed01 = 0
      p.wait -= dt
      if (p.wait <= 0) {
        const n = randomPenPoint()
        p.tx = n.x
        p.tz = n.z
        p.wait = 2 + Math.random() * 5
      }
      continue
    }
    const step = Math.min(dist, WALK * dt)
    p.x += (dx / dist) * step
    p.z += (dz / dist) * step
    const target = Math.atan2(dx, dz)
    p.rotY += Math.atan2(Math.sin(target - p.rotY), Math.cos(target - p.rotY)) * Math.min(1, dt * 6)
    p.speed01 = 1
  }
  for (const id of poses.keys()) if (!state.animals.some((a) => a.id === id)) poses.delete(id)
}

/** Đặt tư thế con vật theo nhân vật đang cưỡi nó. */
export function setPose(id: string, x: number, z: number, rotY: number, speed01: number): void {
  const p = poses.get(id)
  if (!p) return
  Object.assign(p, { x, z, rotY, speed01, tx: x, tz: z })
}

/** Cho con vật đi về một điểm trong bãi thả (sau khi xuống bò). */
export function sendHome(id: string): void {
  const p = poses.get(id)
  if (!p) return
  const n = randomPenPoint()
  Object.assign(p, { tx: n.x, tz: n.z, wait: 0 })
}

/** Con vật đứng yên khi người chơi tới gần để tương tác. */
export function holdStill(id: string, seconds: number): void {
  const p = poses.get(id)
  if (!p) return
  p.tx = p.x
  p.tz = p.z
  p.wait = Math.max(p.wait, seconds)
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}
