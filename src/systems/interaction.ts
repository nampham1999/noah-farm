import { bus } from '../core/events.ts'
import type { AnimalState, GameState, PlacedFurniture, PlotState } from '../core/state.ts'
import { actOnAnimal, animalPose, holdStill } from './animals.ts'
import { HOUSE_DOOR, isWater, plotAt, plotCenter, roomCellAt, STALL } from '../core/world.ts'
import { furnitureAt, furnitureCenter, furnitureDef, sleep } from './house.ts'
import { cast } from './fishing.ts'
import { nextLandPrice } from './land.ts'
import { balance } from '../data/index.ts'
import { actOnPlot, isRipe } from './farming.ts'
import { turnToward, type Dir } from './movement.ts'

/** Đứng cách quầy hàng bao xa thì mở được cửa hàng. */
const STALL_REACH = STALL.r + 1.2
/** Đi tới đích mà không gần thêm được trong khoảng này (giây) thì bỏ, tránh kẹt vào vật cản. */
const STUCK_SECONDS = 0.6

type Goal =
  | { kind: 'walk'; x: number; z: number }
  | { kind: 'plot'; plot: PlotState }
  | { kind: 'stall' }
  | { kind: 'animal'; id: string }
  | { kind: 'fish'; x: number; z: number }
  | { kind: 'house' }
  | { kind: 'bed'; x: number; z: number }

/** Đứng cách cửa nhà / giường chừng này thì vào nhà / ngủ được. */
const DOOR_REACH = 1.8
const BED_REACH = 1.7

/** Thả cần xa tối đa chừng này (m) tính từ chỗ đứng. */
const CAST_RANGE = 4.5

/** Đứng cách con vật chừng này thì tương tác được. */
const ANIMAL_REACH = 1.3

export interface InteractionHooks {
  openShop(): void
  enterHouse(): void
  now(): number
}

/**
 * Nối input với thế giới: chạm vào ô đất thì đi tới rồi làm việc phù hợp,
 * chạm vào quầy thì đi tới rồi mở cửa hàng, chạm vào đất trống thì đi tới đó.
 * Space/nút hành động thì làm việc với ô đất trước mặt.
 */
export class Interaction {
  private readonly state: GameState
  private readonly hooks: InteractionHooks
  private goal: Goal | null = null
  private hover: PlotState | null = null
  private bestDist = Infinity
  private stuckFor = 0

  constructor(state: GameState, hooks: InteractionHooks) {
    this.state = state
    this.hooks = hooks
  }

  /** Người chơi chạm vào điểm (wx, wz) trên mặt đất; onStall là chạm trúng quầy hàng. */
  tapWorld(wx: number, wz: number, onStall: boolean, onHouse = false): void {
    if (this.state.player.indoors) {
      const bed = this.bedAt(wx, wz)
      return this.setGoal(bed ? { kind: 'bed', ...bed } : { kind: 'walk', x: wx, z: wz })
    }
    if (onHouse) return this.setGoal({ kind: 'house' })
    if (onStall) return this.setGoal({ kind: 'stall' })
    if (isWater(wx, wz)) {
      if (this.distTo(wx, wz) <= CAST_RANGE) return this.castAt(wx, wz)
      return this.setGoal({ kind: 'fish', x: wx, z: wz })
    }
    const cell = plotAt(wx, wz)
    const plot = cell && this.plotAtCell(cell.x, cell.z)
    if (plot) return this.setGoal({ kind: 'plot', plot })
    // Khu chưa mua: báo giá, vẫn đi tới đó.
    if (cell) {
      const price = nextLandPrice(this.state)
      if (price !== null && cell.block === this.state.landLevel + 1) bus.emit('notify', { key: 'land.locked', params: { price } })
    }
    this.setGoal({ kind: 'walk', x: wx, z: wz })
  }

  /** Chạm vào con vật: đi tới rồi nhặt sản phẩm, cho ăn hoặc vuốt ve. */
  tapAnimal(id: string): void {
    holdStill(id, 4)
    this.setGoal({ kind: 'animal', id })
  }

  /** Space / nút "Dùng": cầm cần câu và đứng sát nước thì thả cần; không thì làm ô đất trước mặt. */
  useFront(): void {
    const held = this.state.inventory.slots[this.state.inventory.selected]
    if (held?.id === 'tool_fishing_rod') {
      const { pos, rotY } = this.state.player
      const x = pos[0] + Math.sin(rotY) * 2.5
      const z = pos[2] + Math.cos(rotY) * 2.5
      if (isWater(x, z)) return this.castAt(x, z)
    }
    const plot = this.frontPlot()
    if (plot) this.act(plot)
  }

  private castAt(x: number, z: number): void {
    const p = this.state.player.pos
    turnToward(this.state.player, x - p[0], z - p[2])
    this.goal = null
    cast(this.state, x, z)
  }

  /** E / nút "Tương tác": mở cửa hàng nếu đứng gần quầy, không thì như useFront. */
  interact(): void {
    if (this.state.player.indoors) {
      const bed = this.state.house.furniture.find((f) => furnitureDef(f.id).kind === 'bed' && this.distToFurniture(f) < BED_REACH)
      if (bed) sleep(this.state)
      return
    }
    if (this.distTo(HOUSE_DOOR.x, HOUSE_DOOR.z) <= DOOR_REACH) return this.hooks.enterHouse()
    if (this.distTo(STALL.x, STALL.z) <= STALL_REACH) return this.hooks.openShop()
    const animal = this.nearestAnimal()
    if (animal) return this.actAnimal(animal)
    const plot = this.frontPlot()
    if (plot && isRipe(plot)) this.act(plot)
    else this.useFront()
  }

  cancel(): void {
    this.goal = null
  }

  /** Ô đất dưới con trỏ chuột; null khi không rê chuột lên ô nào. */
  setHover(plot: PlotState | null): void {
    this.hover = plot
  }

  /** Ô đất đang nhắm tới (để tô sáng): đích đang đi tới, ô dưới chuột, hoặc ô trước mặt. */
  focusPlot(): PlotState | null {
    if (this.goal?.kind === 'plot') return this.goal.plot
    if (this.hover) return this.hover
    return this.frontPlot()
  }

  /** Gọi mỗi khung hình khi người chơi không tự điều khiển; trả về hướng tự đi. */
  autoWalk(dt: number): Dir {
    const goal = this.goal
    if (!goal) return { x: 0, z: 0 }

    const [tx, tz, stopAt] = this.goalPoint(goal)
    const dist = this.distTo(tx, tz)
    if (dist <= stopAt) {
      this.goal = null
      this.arrive(goal)
      return { x: 0, z: 0 }
    }

    if (dist < this.bestDist - 0.01) {
      this.bestDist = dist
      this.stuckFor = 0
    } else if ((this.stuckFor += dt) > STUCK_SECONDS) {
      this.goal = null
      if (goal.kind === 'fish') bus.emit('notify', { key: 'fish.tooFar' })
      return { x: 0, z: 0 }
    }

    const p = this.state.player.pos
    // Đi chậm lại khi gần tới để không vượt quá đích.
    const speed = Math.min(1, (dist - stopAt) * 3 + 0.3)
    return { x: ((tx - p[0]) / dist) * speed, z: ((tz - p[2]) / dist) * speed }
  }

  private setGoal(goal: Goal): void {
    this.goal = goal
    this.bestDist = Infinity
    this.stuckFor = 0
  }

  private goalPoint(goal: Goal): [number, number, number] {
    switch (goal.kind) {
      case 'walk':
        return [goal.x, goal.z, 0.15]
      case 'stall':
        return [STALL.x, STALL.z, STALL_REACH - 0.2]
      case 'plot': {
        const c = plotCenter(goal.plot.x, goal.plot.z)
        return [c.x, c.z, balance.reach - 0.4]
      }
      case 'fish':
        return [goal.x, goal.z, CAST_RANGE - 0.3]
      case 'house':
        return [HOUSE_DOOR.x, HOUSE_DOOR.z, 0.5]
      case 'bed':
        return [goal.x, goal.z, BED_REACH - 0.3]
      case 'animal': {
        const p = animalPose(goal.id)
        return p ? [p.x, p.z, ANIMAL_REACH - 0.2] : [this.state.player.pos[0], this.state.player.pos[2], 1]
      }
    }
  }

  private arrive(goal: Goal): void {
    if (goal.kind === 'stall') {
      const p = this.state.player.pos
      turnToward(this.state.player, STALL.x - p[0], STALL.z - p[2])
      this.hooks.openShop()
    } else if (goal.kind === 'plot') {
      this.act(goal.plot)
    } else if (goal.kind === 'house') {
      this.hooks.enterHouse()
    } else if (goal.kind === 'bed') {
      sleep(this.state)
    } else if (goal.kind === 'fish') {
      this.castAt(goal.x, goal.z)
    } else if (goal.kind === 'animal') {
      const animal = this.state.animals.find((a) => a.id === goal.id)
      if (animal) this.actAnimal(animal)
    }
  }

  private actAnimal(animal: AnimalState): void {
    const p = animalPose(animal.id)
    if (p) {
      const me = this.state.player.pos
      turnToward(this.state.player, p.x - me[0], p.z - me[2])
      holdStill(animal.id, 2)
    }
    if (actOnAnimal(this.state, animal, this.hooks.now())) bus.emit('saveRequest', undefined)
  }

  /** Giường ở điểm chạm (trong nhà); trả về tâm giường. */
  private bedAt(wx: number, wz: number): { x: number; z: number } | null {
    const cell = roomCellAt(wx, wz)
    if (!cell) return null
    const i = furnitureAt(this.state, cell.cx, cell.cz)
    const f = this.state.house.furniture[i]
    return f && furnitureDef(f.id).kind === 'bed' ? furnitureCenter(f) : null
  }

  private distToFurniture(f: PlacedFurniture): number {
    const c = furnitureCenter(f)
    return this.distTo(c.x, c.z)
  }

  /** Con vật gần nhất trong tầm tay, cho phím E / nút Tương tác. */
  private nearestAnimal(): AnimalState | null {
    let best: AnimalState | null = null
    let bestD = ANIMAL_REACH + 0.3
    for (const a of this.state.animals) {
      const p = animalPose(a.id)
      if (!p) continue
      const d = this.distTo(p.x, p.z)
      if (d < bestD) {
        best = a
        bestD = d
      }
    }
    return best
  }

  private act(plot: PlotState): void {
    const c = plotCenter(plot.x, plot.z)
    const p = this.state.player.pos
    turnToward(this.state.player, c.x - p[0], c.z - p[2])
    if (actOnPlot(this.state, plot, this.hooks.now())) bus.emit('saveRequest', undefined)
  }

  /** Ô đất ngay trước mặt; không có thì ô gần nhất trong tầm với. */
  private frontPlot(): PlotState | null {
    const { pos, rotY } = this.state.player
    const ahead = plotAt(pos[0] + Math.sin(rotY) * 0.9, pos[2] + Math.cos(rotY) * 0.9)
    const aheadPlot = ahead && this.plotAtCell(ahead.x, ahead.z)
    if (aheadPlot) return aheadPlot

    let best: PlotState | null = null
    let bestDist: number = balance.reach
    for (const plot of this.state.plots) {
      const c = plotCenter(plot.x, plot.z)
      const d = this.distTo(c.x, c.z)
      if (d < bestDist) {
        best = plot
        bestDist = d
      }
    }
    return best
  }

  /** Ô đất đã mua ở (cột, hàng); undefined nếu ô đó thuộc khu chưa mua. */
  plotAtCell(x: number, z: number): PlotState | undefined {
    return this.state.plots.find((p) => p.x === x && p.z === z)
  }

  private distTo(x: number, z: number): number {
    const p = this.state.player.pos
    return Math.hypot(x - p[0], z - p[2])
  }
}
