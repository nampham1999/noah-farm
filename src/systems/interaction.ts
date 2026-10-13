import { bus } from '../core/events.ts'
import type { AnimalState, GameState, PlacedFurniture, PlotState } from '../core/state.ts'
import { actOnAnimal, animalPose, holdStill } from './animals.ts'
import {
  FARM_HALF, FIELD, FIELD_GATE, FIELD_GATE_IN, FIELD_GATE_OUT, HOUSE_DOOR, insideField, isWater, ORDER_BOARD, plotAt, plotCenter, roomCellAt, STALL,
} from '../core/world.ts'
import { faceTowards, npcPose, presentNpcs } from './npcs.ts'
import { furnitureAt, furnitureCenter, furnitureDef, sleep } from './house.ts'
import { cast } from './fishing.ts'
import { nextLandPrice } from './land.ts'
import { balance, MACHINE_BY_ID, type MachineId } from '../data/index.ts'
import { actOnPet, petPose } from './pet.ts'
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
  | { kind: 'npc'; id: string }
  | { kind: 'board' }
  | { kind: 'machine'; id: MachineId }
  | { kind: 'pet' }
  | { kind: 'bed'; x: number; z: number }

/** Đứng cách cửa nhà / giường chừng này thì vào nhà / ngủ được. */
const DOOR_REACH = 1.8
/** Đứng cách dân làng chừng này thì nói chuyện được. */
const NPC_REACH = 1.4
const BED_REACH = 1.7
/** Đứng cách máy chế biến chừng này thì dùng được. */
const MACHINE_REACH = 1.3

/** Thả cần xa tối đa chừng này (m) tính từ chỗ đứng. */
const CAST_RANGE = 4.5

/** Đứng cách con vật chừng này thì tương tác được. */
const ANIMAL_REACH = 1.3

export interface InteractionHooks {
  /** Đang thăm nông trại người khác: chỉ đi lại và vào xem nhà. */
  readOnly?: boolean
  openShop(): void
  enterHouse(): void
  openNpc(id: string): void
  openBoard(): void
  /** Tới máy chế biến: lấy hàng nếu xong, không thì mở cửa sổ máy. */
  openMachine(id: MachineId): void
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
    if (this.hooks.readOnly) {
      return this.setGoal(onHouse ? { kind: 'house' } : { kind: 'walk', x: wx, z: wz })
    }
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

  /** Chạm vào dân làng: đi tới rồi nói chuyện. */
  tapNpc(id: string): void {
    faceTowards(id, this.state.player.pos[0], this.state.player.pos[2], 5)
    this.setGoal({ kind: 'npc', id })
  }

  tapBoard(): void {
    this.setGoal({ kind: 'board' })
  }

  /** Chạm vào chó: đi tới rồi lấy quà / vuốt ve. */
  tapPet(): void {
    this.setGoal({ kind: 'pet' })
  }

  tapMachine(id: MachineId): void {
    this.setGoal({ kind: 'machine', id })
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
    if (this.hooks.readOnly) {
      if (!this.state.player.indoors && this.distTo(HOUSE_DOOR.x, HOUSE_DOOR.z) <= DOOR_REACH) this.hooks.enterHouse()
      return
    }
    if (this.state.player.indoors) {
      const bed = this.state.house.furniture.find((f) => furnitureDef(f.id).kind === 'bed' && this.distToFurniture(f) < BED_REACH)
      if (bed) sleep(this.state)
      return
    }
    if (this.distTo(HOUSE_DOOR.x, HOUSE_DOOR.z) <= DOOR_REACH) return this.hooks.enterHouse()
    const npc = presentNpcs(this.state).find((id) => {
      const p = npcPose(id)
      return p && this.distTo(p.x, p.z) <= NPC_REACH + 0.3
    })
    if (npc) return this.talkTo(npc)
    if (this.distTo(ORDER_BOARD.x, ORDER_BOARD.z) <= NPC_REACH + 0.6) return this.hooks.openBoard()
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

    const [gx, gz, stopAt] = this.goalPoint(goal)
    const goalDist = this.distTo(gx, gz)
    // Ở hai phía rào ruộng thì đi vòng qua cổng: tới cổng phía mình, qua cổng, rồi tới đích.
    const via = this.viaGate(gx, gz)
    if (!via && goalDist <= stopAt) {
      this.goal = null
      this.arrive(goal)
      return { x: 0, z: 0 }
    }
    const [tx, tz] = via ?? [gx, gz]
    const dist = via ? this.distTo(tx, tz) : goalDist
    // Đổi điểm đang đi tới (cổng phía này, cổng phía kia, rồi đích): tính lại "bị kẹt" từ đầu.
    if (via !== this.lastVia) {
      this.lastVia = via
      this.bestDist = Infinity
      this.stuckFor = 0
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
    // Đi chậm lại khi gần tới để không vượt quá đích (điểm qua cổng thì đi đều).
    const speed = via ? 1 : Math.min(1, (dist - stopAt) * 3 + 0.3)
    return { x: ((tx - p[0]) / dist) * speed, z: ((tz - p[2]) / dist) * speed }
  }

  private lastVia: [number, number] | null = null

  /**
   * Điểm cần đi qua trước; null nếu đi thẳng tới đích được.
   * - Người chơi và đích ở hai phía rào ruộng: tới cổng phía mình, rồi bước qua cổng.
   * - Ở ngoài ruộng mà đường thẳng cắt ngang ruộng: đi vòng qua góc rào gần nhất.
   */
  private viaGate(tx: number, tz: number): [number, number] | null {
    const [px, , pz] = this.state.player.pos
    if (this.state.player.indoors) return null
    const inside = insideField(px, pz)
    let next: { x: number; z: number } | null = null
    if (inside !== insideField(tx, tz)) {
      const mine = inside ? FIELD_GATE_IN : FIELD_GATE_OUT
      const other = inside ? FIELD_GATE_OUT : FIELD_GATE_IN
      // Đã tới cổng phía mình thì bước sang phía bên kia.
      const atGate = Math.hypot(px - mine.x, pz - mine.z) < 0.5 || Math.abs(pz - FIELD_GATE.z) < FIELD_GATE.half - 0.3 && Math.abs(px - (FIELD_GATE_IN.x + FIELD_GATE_OUT.x) / 2) < 1.4
      if (atGate) return this.keepVia(other.x, other.z)
      // Trong ruộng (hình chữ nhật) thì đi thẳng tới cổng được.
      if (inside) return this.keepVia(mine.x, mine.z)
      next = mine
    } else if (inside) {
      return null
    }
    const [nx, nz] = next ? [next.x, next.z] : [tx, tz]
    const corner = cornerAround(px, pz, nx, nz)
    if (corner) return this.keepVia(corner[0], corner[1])
    return next ? this.keepVia(next.x, next.z) : null
  }

  /** Giữ nguyên mảng điểm qua cũ nếu vẫn là điểm đó, để không tính lại "bị kẹt" mỗi khung hình. */
  private keepVia(x: number, z: number): [number, number] {
    return this.lastVia && this.lastVia[0] === x && this.lastVia[1] === z ? this.lastVia : [x, z]
  }

  private setGoal(goal: Goal): void {
    this.lastVia = null
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
      case 'npc': {
        const p = npcPose(goal.id)
        return p ? [p.x, p.z, NPC_REACH] : [this.state.player.pos[0], this.state.player.pos[2], 1]
      }
      case 'board':
        return [ORDER_BOARD.x, ORDER_BOARD.z, NPC_REACH + 0.3]
      case 'pet': {
        const p = petPose()
        return [p.x, p.z, ANIMAL_REACH]
      }
      case 'machine': {
        const m = MACHINE_BY_ID.get(goal.id)!
        return [m.x, m.z, MACHINE_REACH]
      }
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
    } else if (goal.kind === 'npc') {
      this.talkTo(goal.id)
    } else if (goal.kind === 'board') {
      const me = this.state.player.pos
      turnToward(this.state.player, ORDER_BOARD.x - me[0], ORDER_BOARD.z - me[2])
      this.hooks.openBoard()
    } else if (goal.kind === 'pet') {
      const p = petPose()
      const me = this.state.player.pos
      turnToward(this.state.player, p.x - me[0], p.z - me[2])
      actOnPet(this.state)
    } else if (goal.kind === 'machine') {
      const m = MACHINE_BY_ID.get(goal.id)!
      const me = this.state.player.pos
      turnToward(this.state.player, m.x - me[0], m.z - me[2])
      this.hooks.openMachine(goal.id)
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

  private talkTo(id: string): void {
    const p = npcPose(id)
    const me = this.state.player.pos
    if (p) turnToward(this.state.player, p.x - me[0], p.z - me[2])
    faceTowards(id, me[0], me[2], 6)
    this.hooks.openNpc(id)
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

/** Lề quanh rào ruộng khi xét đường đi có cắt qua ruộng không, và độ lùi của các góc vòng qua. */
const FIELD_MARGIN = 0.6
const CORNER_OFFSET = 1.3

/** Đoạn thẳng từ (ax, az) tới (bx, bz) có cắt khu ruộng (nới thêm lề) không. */
function crossesField(ax: number, az: number, bx: number, bz: number): boolean {
  const x0 = FIELD.x0 - FIELD_MARGIN
  const x1 = FIELD.x1 + FIELD_MARGIN
  const z0 = FIELD.z0 - FIELD_MARGIN
  const z1 = FIELD.z1 + FIELD_MARGIN
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dz = bz - az
  // Cắt đoạn thẳng theo từng cạnh (Liang-Barsky).
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/** Góc rào ruộng nên đi vòng qua khi đường thẳng từ người chơi tới điểm kế tiếp cắt ngang ruộng. */
function cornerAround(px: number, pz: number, nx: number, nz: number): [number, number] | null {
  if (!crossesField(px, pz, nx, nz)) return null
  // Đang đứng sát rào (ví dụ vừa ra khỏi cổng): bước ra xa rào theo cạnh gần nhất trước.
  const gaps: [number, number, number][] = [
    [px - (FIELD.x0 - FIELD_MARGIN), FIELD.x0 - FIELD_MARGIN - 0.4, pz],
    [FIELD.x1 + FIELD_MARGIN - px, FIELD.x1 + FIELD_MARGIN + 0.4, pz],
    [pz - (FIELD.z0 - FIELD_MARGIN), px, FIELD.z0 - FIELD_MARGIN - 0.4],
    [FIELD.z1 + FIELD_MARGIN - pz, px, FIELD.z1 + FIELD_MARGIN + 0.4],
  ]
  if (gaps.every(([g]) => g > 0)) {
    const [, ex, ez] = gaps.reduce((a, b) => (b[0] < a[0] ? b : a))
    return [ex, ez]
  }
  const corners: [number, number][] = [
    [FIELD.x0 - CORNER_OFFSET, FIELD.z0 - CORNER_OFFSET],
    [FIELD.x1 + CORNER_OFFSET, FIELD.z0 - CORNER_OFFSET],
    [FIELD.x0 - CORNER_OFFSET, FIELD.z1 + CORNER_OFFSET],
    [FIELD.x1 + CORNER_OFFSET, FIELD.z1 + CORNER_OFFSET],
  ]
  let best: [number, number] | null = null
  let bestLen = Infinity
  for (const c of corners) {
    if (Math.abs(c[0]) > FARM_HALF - 0.6 || Math.abs(c[1]) > FARM_HALF - 0.6) continue
    if (crossesField(px, pz, c[0], c[1])) continue
    const len = Math.hypot(c[0] - px, c[1] - pz) + Math.hypot(nx - c[0], nz - c[1])
    if (len < bestLen) {
      bestLen = len
      best = c
    }
  }
  return best
}

