import { bus } from '../core/events.ts'
import type { GameState, MachineState } from '../core/state.ts'
import { CROPS, HONEY, item, MACHINE_BY_ID, RECIPES, type MachineId, type RecipeDef } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem } from './inventory.ts'
import { gainXp } from './progress.ts'

/**
 * Chế biến: hũ ủ (nông sản → mứt / đồ muối), bếp (nguyên liệu → món ăn), tổ ong (tự cho mật).
 * Mỗi máy làm một mẻ một lúc; thời gian tính bằng dấu thời gian thật nên chạy cả khi đóng tab.
 */

export type MachineStatus = 'missing' | 'empty' | 'working' | 'ready'

/** Một việc máy làm được: nguyên liệu cụ thể (đã chọn từ túi) và thứ làm ra. */
export interface Job {
  output: string
  icon: string
  /** Nguyên liệu sẽ lấy, null nếu trong túi không đủ. */
  take: { id: string; qty: number }[] | null
  /** Nguyên liệu cần, để hiện cho người chơi. */
  needs: { label: string; icon: string; qty: number }[]
  minutes: number
}

const XP_PER_BATCH = 4

export function machineState(state: GameState, id: MachineId): MachineState | undefined {
  return state.machines.find((m) => m.id === id)
}

export function machineStatus(state: GameState, id: MachineId, t: number): MachineStatus {
  const m = machineState(state, id)
  if (!m) return 'missing'
  if (!m.output) return 'empty'
  return t >= m.readyAt ? 'ready' : 'working'
}

export function buyMachine(state: GameState, id: MachineId, t: number): boolean {
  const def = MACHINE_BY_ID.get(id)!
  if (machineState(state, id)) return false
  if (state.player.level < def.level) return fail('notice.locked', { level: def.level })
  if (state.player.gold < def.price) return fail('notice.noGold')
  state.player.gold -= def.price
  const m: MachineState = { id, output: null, qty: 0, readyAt: 0 }
  state.machines.push(m)
  if (id === 'beehive') startHoney(m, t)
  bus.emit('notify', { key: 'machine.bought', params: { name: `machine.${id}` }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/** Các việc máy làm được, theo những gì đang có trong túi (đủ nguyên liệu xếp trước). */
export function jobsFor(state: GameState, id: MachineId): Job[] {
  const minutes = MACHINE_BY_ID.get(id)!.minutes
  if (id === 'preserves') {
    // Mỗi loại nông sản đang có thành một hũ.
    return CROPS.filter((c) => countItem(state.inventory, `crop_${c.id}`) > 0).map((c) => ({
      output: `jar_${c.id}`,
      icon: '🫙',
      take: [{ id: `crop_${c.id}`, qty: 1 }],
      needs: [{ label: `crop_${c.id}`, icon: c.icon, qty: 1 }],
      minutes,
    }))
  }
  if (id === 'stove') {
    return RECIPES.map((r) => recipeJob(state, r, minutes)).sort((a, b) => Number(!a.take) - Number(!b.take))
  }
  return []
}

function recipeJob(state: GameState, r: RecipeDef, minutes: number): Job {
  const take: { id: string; qty: number }[] = []
  let ok = true
  for (const input of r.inputs) {
    if (input.id) {
      if (countItem(state.inventory, input.id) < input.qty) ok = false
      take.push({ id: input.id, qty: input.qty })
      continue
    }
    // "Bất kỳ" (cá, nông sản): lấy loại rẻ nhất đang có, có thể gộp nhiều loại.
    let left = input.qty
    const have = [...new Set(state.inventory.slots.flatMap((s) => (s && item(s.id).kind === input.kind ? [s.id] : [])))]
      .sort((a, b) => (item(a).sellPrice ?? 0) - (item(b).sellPrice ?? 0))
    for (const id of have) {
      const n = Math.min(left, countItem(state.inventory, id))
      if (n > 0) take.push({ id, qty: n })
      left -= n
      if (left <= 0) break
    }
    if (left > 0) ok = false
  }
  return {
    output: `food_${r.id}`,
    icon: r.icon,
    take: ok ? take : null,
    needs: r.inputs.map((i) => ({
      label: i.id ?? `kind.${i.kind}`,
      icon: i.id ? item(i.id).icon : i.kind === 'fish' ? '🐟' : '🥬',
      qty: i.qty,
    })),
    minutes,
  }
}

/** Bắt đầu một mẻ: trừ nguyên liệu, hẹn giờ xong. */
export function startJob(state: GameState, id: MachineId, job: Job, t: number): boolean {
  const m = machineState(state, id)
  if (!m || m.output || !job.take) return false
  for (const { id: itemId, qty } of job.take) removeItem(state.inventory, itemId, qty)
  m.output = job.output
  m.qty = 1
  m.readyAt = t + job.minutes * 60_000
  bus.emit('sfx', 'place')
  bus.emit('saveRequest', undefined)
  return true
}

/** Lấy hàng khi máy đã xong; tổ ong thì bắt đầu đợt mật mới. */
export function collect(state: GameState, id: MachineId, t: number): boolean {
  const m = machineState(state, id)
  if (!m?.output || t < m.readyAt) return false
  if (!canFit(state.inventory, m.output, m.qty)) return fail('notice.bagFull')
  addItem(state.inventory, m.output, m.qty)
  bus.emit('notify', { key: 'machine.collected', params: { item: m.output, qty: m.qty }, good: true })
  bus.emit('progress', { type: 'collect', amount: m.qty, id: m.output })
  gainXp(state, XP_PER_BATCH)
  m.output = null
  m.qty = 0
  if (id === 'beehive') startHoney(m, t)
  bus.emit('saveRequest', undefined)
  return true
}

function startHoney(m: MachineState, t: number): void {
  m.output = HONEY.id
  m.qty = 1
  m.readyAt = t + MACHINE_BY_ID.get('beehive')!.minutes * 60_000
}

/** Mỗi khung hình: mùa đông ong ngủ, tổ ong đang làm mật thì dời giờ xong theo. */
export function updateMachines(state: GameState, t: number, prevT: number): void {
  if (state.clock.season !== 'winter' || t <= prevT) return
  const hive = machineState(state, 'beehive')
  if (hive?.output && t < hive.readyAt) hive.readyAt += t - prevT
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}
