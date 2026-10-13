import { bus } from '../core/events.ts'
import type { GameState, PlotState } from '../core/state.ts'
import { balance, CROP_BY_ID, item, type CropDef } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem, selectedStack } from './inventory.ts'
import { gainXp, useStamina } from './progress.ts'

/**
 * Đất và cây trồng (GDD mục 3.1).
 * Cây chia `cropStages` giai đoạn đều nhau. Mỗi giai đoạn cần tưới một lần (lúc nào
 * trong giai đoạn cũng được); hết thời gian mà chưa tưới thì cây đứng chờ.
 * Thời gian tính theo dấu thời gian nên cây vẫn lớn khi đóng tab.
 */

export type PlotAction = 'till' | 'plant' | 'water' | 'harvest'

const STAGES = balance.cropStages

export function cropOf(plot: PlotState): CropDef | null {
  return plot.crop ? CROP_BY_ID.get(plot.crop) ?? null : null
}

export function isRipe(plot: PlotState): boolean {
  return plot.crop !== null && plot.stage >= STAGES
}

export function needsWater(plot: PlotState): boolean {
  return plot.crop !== null && plot.stage < STAGES && plot.wateredAt === null
}

function stageMs(crop: CropDef): number {
  return (crop.growMinutes * 60_000) / STAGES
}

/** Thời gian còn lại (ms) đến khi chín, giả sử được tưới đúng lúc. */
export function timeToRipe(plot: PlotState, t: number): number {
  const crop = cropOf(plot)
  if (!crop || isRipe(plot)) return 0
  const left = Math.max(0, plot.stageStartedAt + stageMs(crop) - t)
  return left + (STAGES - 1 - plot.stage) * stageMs(crop)
}

/** Cho cây lớn tới thời điểm t. Gọi mỗi khung hình, và một lần khi mở game để tính bù. */
export function updateCrops(state: GameState, t: number): void {
  for (const plot of state.plots) {
    const crop = cropOf(plot)
    if (!crop || !crop.seasons.includes(state.clock.season)) continue
    while (plot.stage < STAGES && plot.wateredAt !== null) {
      const end = plot.stageStartedAt + stageMs(crop)
      if (t < end) break
      plot.stage++
      // Tưới trễ sau khi hết giờ thì giai đoạn mới tính từ lúc tưới.
      plot.stageStartedAt = Math.max(end, plot.wateredAt)
      plot.wateredAt = null
    }
  }
}

/** Dời mọi dấu thời gian của cây đi `delta` ms (dùng khi tính bù có giới hạn hoặc đồng hồ máy bị lùi). */
export function shiftTimestamps(state: GameState, delta: number): void {
  for (const plot of state.plots) {
    if (!plot.crop) continue
    plot.stageStartedAt += delta
    if (plot.wateredAt !== null) plot.wateredAt += delta
  }
}

/** Hạt sẽ gieo: hạt đang chọn trên thanh công cụ, nếu không thì hạt đầu tiên gieo được. */
function seedToPlant(state: GameState): string | null {
  const sel = selectedStack(state.inventory)
  if (sel && item(sel.id).kind === 'seed') return sel.id
  for (const s of state.inventory.slots) {
    if (s && item(s.id).kind === 'seed' && CROP_BY_ID.get(item(s.id).cropId!)!.seasons.includes(state.clock.season)) {
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
  const action = actionFor(plot)
  const inv = state.inventory

  switch (action) {
    case 'till':
      if (!countItem(inv, 'tool_hoe')) return fail('notice.needHoe')
      plot.tilled = true
      useStamina(state, balance.staminaCost.till)
      gainXp(state, balance.xpPerAction.till)
      return true

    case 'plant': {
      const seedId = seedToPlant(state)
      if (!seedId) return fail('notice.noSeeds')
      const crop = CROP_BY_ID.get(item(seedId).cropId!)!
      if (!crop.seasons.includes(state.clock.season)) {
        return fail('notice.wrongSeason', { item: seedId })
      }
      removeItem(inv, seedId, 1)
      plot.crop = crop.id
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
      useStamina(state, balance.staminaCost.water)
      gainXp(state, balance.xpPerAction.water)
      return true

    case 'harvest': {
      const crop = cropOf(plot)!
      const produce = `crop_${crop.id}`
      if (!canFit(inv, produce, 1)) return fail('notice.bagFull')
      addItem(inv, produce, 1)
      plot.crop = null
      plot.stage = 0
      plot.wateredAt = null
      useStamina(state, balance.staminaCost.harvest)
      gainXp(state, crop.xp)
      bus.emit('notify', { key: 'notice.harvested', params: { item: produce, xp: crop.xp }, good: true })
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
