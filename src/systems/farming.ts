import { bus } from '../core/events.ts'
import { inGreenhouse } from '../core/world.ts'
import type { GameState, PlotState } from '../core/state.ts'
import { balance, CROP_BY_ID, item, type CropDef } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem, selectedStack } from './inventory.ts'
import { gainXp, useStamina } from './progress.ts'

/**
 * Đất và cây trồng (GDD mục 3.1).
 * Cây chia `cropStages` giai đoạn đều nhau và tự lớn tới khi chín. Tưới một lần (trời mưa thì tự được tưới)
 * thì thu hoạch được gấp đôi; không tưới vẫn chín đúng hạn nhưng chỉ được một nửa.
 * Thời gian tính theo dấu thời gian nên cây vẫn lớn khi đóng tab. Cây bị sâu lớn chậm một nửa.
 */

export type PlotAction = 'till' | 'plant' | 'water' | 'harvest'

const STAGES = balance.cropStages

export function cropOf(plot: PlotState): CropDef | null {
  return plot.crop ? CROP_BY_ID.get(plot.crop) ?? null : null
}

export function isRipe(plot: PlotState): boolean {
  return plot.crop !== null && plot.stage >= STAGES
}

/** Số nông sản mỗi ô khi thu hoạch: tưới (ít nhất một lần) thì gấp đôi cây không tưới. */
export const WATERED_YIELD = 2

/** Ô chưa được tưới: vẫn chín đúng hạn nhưng thu được ít hơn. */
export function needsWater(plot: PlotState): boolean {
  return plot.crop !== null && plot.stage < STAGES && plot.wateredAt === null
}

function stageMs(crop: CropDef): number {
  return (crop.growMinutes * 60_000) / STAGES
}

/** Thời gian còn lại (ms) đến khi chín. */
export function timeToRipe(plot: PlotState, t: number): number {
  const crop = cropOf(plot)
  if (!crop || isRipe(plot)) return 0
  const left = Math.max(0, plot.stageStartedAt + stageMs(crop) - t)
  return left + (STAGES - 1 - plot.stage) * stageMs(crop)
}

/**
 * Cho cây lớn tới thời điểm t. Gọi mỗi khung hình, và một lần khi mở game để tính bù.
 * prevT là lần gọi trước: cây bị sâu đứng yên, nên dời mốc giai đoạn đi đúng khoảng thời gian đó
 * để khi bắt sâu xong cây lớn tiếp chứ không nhảy cóc.
 */
export function updateCrops(state: GameState, t: number, prevT = t): void {
  for (const plot of state.plots) {
    const crop = cropOf(plot)
    if (!crop) continue
    // Bị sâu thì lớn chậm một nửa: dời mốc thời gian theo nửa khoảng trôi qua. (Mùa chỉ quyết định gieo được hay không;
    // cây đã gieo cứ lớn tới khi chín dù giữa chừng sang mùa khác, và sâu không bao giờ giữ cây mãi mãi.)
    if (state.pests.includes(`${plot.x},${plot.z}`) && plot.stage < STAGES && t > prevT) {
      const slow = (t - prevT) / 2
      plot.stageStartedAt += slow
      if (plot.wateredAt !== null) plot.wateredAt += slow
    }
    // Cây lớn theo thời gian từ lúc gieo, tưới hay không đều chín (treo máy hay đóng game vẫn lớn). Tưới thì được nhiều nông sản hơn.
    while (plot.stage < STAGES) {
      const end = plot.stageStartedAt + stageMs(crop)
      if (t < end) break
      plot.stage++
      plot.stageStartedAt = end
    }
  }
}

/** Dời mọi dấu thời gian (cây và vật nuôi) đi `delta` ms (dùng khi tính bù có giới hạn hoặc đồng hồ máy bị lùi). */
export function shiftTimestamps(state: GameState, delta: number): void {
  for (const plot of state.plots) {
    if (!plot.crop) continue
    plot.stageStartedAt += delta
    if (plot.wateredAt !== null) plot.wateredAt += delta
  }
  for (const a of state.animals) {
    if (a.fedAt !== null) a.fedAt += delta
  }
  for (const m of state.machines) {
    if (m.output) m.readyAt += delta
  }
  for (const tree of state.orchard) {
    tree.plantedAt += delta
    if (tree.pickedAt !== null) tree.pickedAt += delta
  }
}

/** Hạt sẽ gieo: hạt đang chọn trên thanh công cụ, nếu không thì hạt đầu tiên gieo được. */
function seedToPlant(state: GameState, anySeason: boolean): string | null {
  const sel = selectedStack(state.inventory)
  if (sel && item(sel.id).kind === 'seed') return sel.id
  for (const s of state.inventory.slots) {
    if (s && item(s.id).kind === 'seed' && (anySeason || CROP_BY_ID.get(item(s.id).cropId!)!.seasons.includes(state.clock.season))) {
      return s.id
    }
  }
  return null
}

/** Việc sẽ làm khi chạm vào ô đất này, tuỳ trạng thái ô (thao tác theo ngữ cảnh). */
export function actionFor(plot: PlotState): PlotAction | null {
  if (isRipe(plot)) return 'harvest'
  if (!plot.tilled) return 'till'
  if (!plot.crop) return 'plant'
  if (needsWater(plot)) return 'water'
  return null
}

/** Làm việc phù hợp với ô đất. Trả về true nếu có thay đổi. */
export function actOnPlot(state: GameState, plot: PlotState, t: number): boolean {
  const pestKey = `${plot.x},${plot.z}`
  if (state.pests.includes(pestKey)) {
    state.pests.splice(state.pests.indexOf(pestKey), 1)
    bus.emit('notify', { key: 'pest.removed', good: true })
    bus.emit('sfx', 'harvest')
    return true
  }
  const action = actionFor(plot)
  const inv = state.inventory

  switch (action) {
    case 'till':
      if (!countItem(inv, 'tool_hoe')) return fail('notice.needHoe')
      plot.tilled = true
      bus.emit('progress', { type: 'till', amount: 1 })
      useStamina(state, balance.staminaCost.till)
      gainXp(state, balance.xpPerAction.till)
      return true

    case 'plant': {
      // Luống nhà kính trồng được mọi mùa.
      const warm = inGreenhouse(plot.x, plot.z)
      const seedId = seedToPlant(state, warm)
      if (!seedId) return fail('notice.noSeeds')
      const crop = CROP_BY_ID.get(item(seedId).cropId!)!
      if (!warm && !crop.seasons.includes(state.clock.season)) {
        return fail('notice.wrongSeason', { item: seedId })
      }
      removeItem(inv, seedId, 1)
      plot.crop = crop.id
      bus.emit('progress', { type: 'plant', amount: 1, id: crop.id })
      plot.stage = 0
      plot.stageStartedAt = t
      plot.wateredAt = null
      useStamina(state, balance.staminaCost.plant)
      gainXp(state, balance.xpPerAction.plant)
      return true
    }

    case 'water':
      if (!countItem(inv, 'tool_watering_can')) return fail('notice.needCan')
      plot.wateredAt = t
      bus.emit('progress', { type: 'water', amount: 1 })
      useStamina(state, balance.staminaCost.water)
      gainXp(state, balance.xpPerAction.water)
      return true

    case 'harvest': {
      const crop = cropOf(plot)!
      const produce = `crop_${crop.id}`
      const qty = plot.wateredAt !== null ? WATERED_YIELD : 1
      if (!canFit(inv, produce, qty)) return fail('notice.bagFull')
      addItem(inv, produce, qty)
      plot.crop = null
      plot.stage = 0
      plot.wateredAt = null
      useStamina(state, balance.staminaCost.harvest)
      gainXp(state, crop.xp)
      bus.emit('progress', { type: 'harvest', amount: qty, id: crop.id })
      bus.emit('notify', { key: 'notice.harvested', params: { item: produce, xp: crop.xp, qty }, good: true })
      return true
    }

    default: {
      const minutes = Math.ceil(timeToRipe(plot, t) / 60_000)
      bus.emit('notify', { key: 'notice.growing', params: { item: `crop_${plot.crop}`, minutes } })
      return false
    }
  }
}

function fail(key: string, params?: Record<string, string | number>): false {
  bus.emit('notify', { key, params })
  return false
}
