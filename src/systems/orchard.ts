import { bus } from '../core/events.ts'
import type { GameState, OrchardTree } from '../core/state.ts'
import { DAY_MS, ORCHARD, TREE_BY_ID, type TreeId } from '../data/index.ts'
import { addItem, canFit, removeItem } from './inventory.ts'
import { gainXp } from './progress.ts'

/**
 * Cây ăn quả: mua cây giống, trồng ở ô vườn cố định. Cây lớn trong growMinutes phút thật,
 * rồi trong mùa của nó mỗi ngày game ra một lứa quả để hái. Trái mùa thì chỉ đứng xanh.
 */

export type TreeStatus = 'growing' | 'resting' | 'fruit'

const PICK_XP = 6

export function treeAt(state: GameState, spot: number): OrchardTree | undefined {
  return state.orchard.find((t) => t.spot === spot)
}

/** Độ lớn 0..1 của cây (1 là trưởng thành). */
export function treeGrowth(tree: OrchardTree, t: number): number {
  return Math.min(1, Math.max(0, (t - tree.plantedAt) / (ORCHARD.growMinutes * 60_000)))
}

export function treeStatus(state: GameState, tree: OrchardTree, t: number): TreeStatus {
  if (treeGrowth(tree, t) < 1) return 'growing'
  if (!TREE_BY_ID.get(tree.type)!.seasons.includes(state.clock.season)) return 'resting'
  // Lứa quả mới sau mỗi ngày game kể từ lần hái trước (lần đầu: ngay khi trưởng thành).
  return tree.pickedAt === null || t - tree.pickedAt >= DAY_MS ? 'fruit' : 'resting'
}

/** Cây giống đầu tiên có trong túi. */
function saplingInBag(state: GameState): TreeId | null {
  for (const s of state.inventory.slots) {
    if (s?.id.startsWith('sapling_')) return s.id.slice('sapling_'.length) as TreeId
  }
  return null
}

/** Chạm vào ô vườn: trống thì trồng cây giống, có quả thì hái, không thì báo tình trạng. */
export function actOnSpot(state: GameState, spot: number, t: number): boolean {
  const tree = treeAt(state, spot)
  if (!tree) {
    const type = saplingInBag(state)
    if (!type) {
      bus.emit('notify', { key: 'tree.needSapling' })
      return false
    }
    removeItem(state.inventory, `sapling_${type}`, 1)
    state.orchard.push({ spot, type, plantedAt: t, pickedAt: null })
    bus.emit('notify', { key: 'tree.planted', params: { name: `tree.fruit.${type}` }, good: true })
    bus.emit('progress', { type: 'plant', amount: 1, id: `tree_${type}` })
    bus.emit('saveRequest', undefined)
    return true
  }
  const status = treeStatus(state, tree, t)
  if (status === 'fruit') {
    const id = `fruit_${tree.type}`
    const qty = ORCHARD.fruitPerHarvest
    if (!canFit(state.inventory, id, qty)) {
      bus.emit('notify', { key: 'notice.bagFull' })
      return false
    }
    addItem(state.inventory, id, qty)
    tree.pickedAt = t
    gainXp(state, PICK_XP)
    bus.emit('progress', { type: 'harvest', amount: qty, id })
    bus.emit('notify', { key: 'tree.picked', params: { item: id, qty }, good: true })
    bus.emit('saveRequest', undefined)
    return true
  }
  if (status === 'growing') {
    const left = Math.ceil((1 - treeGrowth(tree, t)) * ORCHARD.growMinutes)
    bus.emit('notify', { key: 'tree.growing', params: { minutes: left } })
  } else {
    const def = TREE_BY_ID.get(tree.type)!
    bus.emit('notify', { key: def.seasons.includes(state.clock.season) ? 'tree.tomorrow' : 'tree.offSeason', params: { a: `season.${def.seasons[0]}`, b: `season.${def.seasons[1]}` } })
  }
  return false
}
