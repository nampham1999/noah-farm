import { bus } from '../core/events.ts'
import { inGreenhouse } from '../core/world.ts'
import type { GameState, PlotState } from '../core/state.ts'
import { balance, CROP_BY_ID, item, type CropDef } from '../data/index.ts'
import { addItem, canFit, countItem, removeItem, selectedStack } from './inventory.ts'
import { gainXp, useStamina } from './progress.ts'

/**
 * Đất và cây trồng (GDD mục 3.1).
 * Cây chia `cropStages` giai đoạn đều nhau. Gieo xong tưới một lần là cây tự lớn tới khi chín;
 * chưa tưới thì cây đứng chờ (trời mưa thì tự được tưới).
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

/**
 * Cho cây lớn tới thời điểm t. Gọi mỗi khung hình, và một lần khi mở game để tính bù.
 * prevT là lần gọi trước: cây sai mùa (chưa chín) đứng yên, nên dời mốc giai đoạn
 * đi đúng khoảng thời gian đó để khi về đúng mùa cây lớn tiếp chứ không nhảy cóc.
 */
export function updateCrops(state: GameState, t: number, prevT = t): void {
  for (const plot of state.plots) {
    const crop = cropOf(plot)
    if (!crop) continue
    // Trái mùa (ngoài nhà kính) hoặc bị sâu thì đứng yên: dời mốc thời gian theo.
    if ((!crop.seasons.includes(state.clock.season) && !inGreenhouse(plot.x, plot.z)) || state.pests.includes(`${plot.x},${plot.z}`)) {
      if (plot.stage < STAGES && t > prevT) {
        plot.stageStartedAt += t - prevT
        if (plot.wateredAt !== null) plot.wateredAt += t - prevT
      }
      continue
    }
    // Đã tưới thì lớn liền một mạch tới khi chín (treo máy hay đóng game vẫn lớn).
    while (plot.stage < STAGES && plot.wateredAt !== null) {
      const end = plot.stageStartedAt + stageMs(crop)
      if (t < end) break
      plot.stage++
      // Tưới trễ sau khi hết giờ giai đoạn đầu thì giai đoạn mới tính từ lúc tưới.
      plot.stageStartedAt = Math.max(end, plot.wateredAt)
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
      if (!canFit(inv, produce, 1)) return fail('notice.bagFull')
      addItem(inv, produce, 1)
      plot.crop = null
      plot.stage = 0
      plot.wateredAt = null
      useStamina(state, balance.staminaCost.harvest)
      gainXp(state, crop.xp)
      bus.emit('progress', { type: 'harvest', amount: 1, id: crop.id })
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
