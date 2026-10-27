import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RESTAURANT, RESTAURANT_SPOTS as SPOT } from '../core/world.ts'
import { NPCS } from '../systems/orders.ts'
import { staffWalk } from '../systems/restaurant.ts'
import { createCharacter } from './character.ts'
import type { Farmer } from './models.ts'

export interface StaffView {
  update(state: GameState, dt: number, time: number): void
}

interface Step {
  x: number
  z: number
  /** Đứng lại bao lâu (giây) khi tới nơi. */
  wait: number
  /** Hướng nhìn khi đứng lại (rad), bỏ trống thì giữ hướng đang đi. */
  face?: number
}

interface Rig {
  farmer: Farmer
  look: number
  queue: Step[]
  wait: number
  face: number | undefined
  /** Lần đi phục vụ đã xử lý (để nhận biết có việc mới). */
  lastWalk: number
  working: boolean
}

const CHEF_SPEED = 1.7
const WAITER_SPEED = 2.5
const FRONT = RESTAURANT.z + RESTAURANT.d / 2
const NORTH = Math.PI
const SOUTH = 0
/** Điểm đi qua cửa: trong nhà ra ngoài hay ngược lại đều phải qua đây. */
const DOOR_IN = { x: RESTAURANT.x, z: FRONT - 0.4 }
const DOOR_OUT = { x: RESTAURANT.x, z: FRONT + 0.7 }
const inside = (z: number) => z < FRONT - 0.2

/** Nhân viên nhà hàng: đầu bếp đi lại giữa bếp, bàn sơ chế và tủ lạnh; người phục vụ nhận món ở quầy, đi qua cửa ra tận bàn khách. */
export function createStaffView(scene: THREE.Scene): StaffView {
  const rigs = new Map<number, Rig>()
  const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

  /** Thêm các điểm đi qua cửa nếu đường đi từ trong ra ngoài (hoặc ngược lại). */
  const route = (from: { z: number }, steps: Step[]): Step[] => {
    const out: Step[] = []
    let isIn = inside(from.z)
    for (const s of steps) {
      const target = inside(s.z)
      if (target !== isIn) {
        out.push(isIn ? { ...DOOR_IN, wait: 0 } : { ...DOOR_OUT, wait: 0 }, isIn ? { ...DOOR_OUT, wait: 0 } : { ...DOOR_IN, wait: 0 })
        isIn = target
      }
      out.push(s)
    }
    return out
  }

  return {
    update(state, dt, time) {
      const outdoors = !state.player.indoors
      const live = new Set<number>()
      let chefs = 0
      let waiters = 0
      for (const sf of state.restaurant.staff) {
        live.add(sf.id)
        const chef = sf.role === 'chef'
        const slot = chef ? chefs++ : waiters++
        let rig = rigs.get(sf.id)
        if (!rig || rig.look !== sf.look) {
          if (rig) scene.remove(rig.farmer.root)
          const base = NPCS[sf.look % NPCS.length].look
          const look = chef ? { ...base, hat: 'chef' as const, apron: '#fffaf0' } : { ...base, hat: undefined, apron: '#2f4a7a' }
          const farmer = createCharacter(look)
          const home = chef ? { x: SPOT.prep.x + slot * 1.4, z: SPOT.prep.z } : { x: SPOT.pass.x + 1.2 + slot * 1.1, z: SPOT.pass.z }
          farmer.root.position.set(home.x, 0.28, home.z)
          scene.add(farmer.root)
          rig = { farmer, look: sf.look, queue: [], wait: 0, face: undefined, lastWalk: 0, working: false }
          rigs.set(sf.id, rig)
        }
        const root = rig.farmer.root
        root.visible = outdoors
        if (!outdoors) continue

        // Việc mới của người phục vụ (đã mang món cho khách): nhận món ở quầy, qua cửa, tới bàn, rồi về quầy.
        const walk = staffWalk.get(sf.id)
        if (!chef && walk && walk.until !== rig.lastWalk) {
          rig.lastWalk = walk.until
          rig.queue = route(root.position, [
            { x: SPOT.pass.x + 0.3 * slot, z: SPOT.pass.z, wait: 0.5, face: SOUTH },
            { x: walk.x, z: walk.z + 0.95, wait: 2.0, face: NORTH },
            { x: SPOT.pass.x + 1.2 + slot * 1.1, z: SPOT.pass.z, wait: 0.3 },
          ])
          rig.wait = 0
        }
        // Hết việc thì đi lại cho sinh động: đầu bếp theo việc đang làm, người phục vụ dạo quanh quầy, cửa và sân.
        if (!rig.queue.length && rig.wait <= 0) {
          if (chef) {
            rig.working = !!sf.cooking
            rig.queue = sf.cooking
              ? [{ ...SPOT.stove, wait: 2.4, face: NORTH }, { ...SPOT.prep, wait: 1.8, face: NORTH }, { ...SPOT.fridge, wait: 1.4, face: NORTH }, { ...SPOT.prep, wait: 1.2, face: NORTH }]
              : [{ ...SPOT.prep, wait: 2.5, face: NORTH }, { x: SPOT.pass.x + 0.6, z: SPOT.pass.z - 0.2, wait: 2, face: SOUTH }]
          } else {
            const stops = [
              { x: SPOT.pass.x + 0.4, z: SPOT.pass.z, wait: 2.5, face: SOUTH },
              { x: RESTAURANT.x + 1.6, z: FRONT + 1.6, wait: 2.2, face: SOUTH },
              { x: RESTAURANT.x - 2.2, z: FRONT + 2.0, wait: 2.2, face: SOUTH },
              { x: RESTAURANT.x + 2.4, z: SPOT.pass.z + 0.2, wait: 1.8, face: SOUTH },
            ]
            rig.queue = route(root.position, [pick(stops)])
          }
        }

        // Đi tới điểm kế tiếp trong hàng đợi.
        let moving = 0
        const step = rig.queue[0]
        if (rig.wait > 0) {
          rig.wait -= dt
          if (rig.face !== undefined) root.rotation.y += Math.atan2(Math.sin(rig.face - root.rotation.y), Math.cos(rig.face - root.rotation.y)) * Math.min(1, dt * 8)
        } else if (step) {
          const dx = step.x - root.position.x
          const dz = step.z - root.position.z
          const dist = Math.hypot(dx, dz)
          if (dist < 0.06) {
            rig.queue.shift()
            rig.wait = step.wait
            rig.face = step.face
          } else {
            const v = Math.min(dist, (chef ? CHEF_SPEED : WAITER_SPEED) * dt)
            root.position.x += (dx / dist) * v
            root.position.z += (dz / dist) * v
            const want = Math.atan2(dx, dz)
            root.rotation.y += Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y)) * Math.min(1, dt * 10)
            moving = 0.6
          }
        }
        // Sàn trong nhà cao hơn mặt đất một chút; đầu bếp nhún nhẹ khi đang đứng nấu.
        const base = inside(root.position.z) ? 0.28 : 0
        const working = chef && sf.cooking && rig.wait > 0 && moving === 0
        root.position.y = base + (working ? Math.abs(Math.sin(time * 7 + sf.id)) * 0.07 : 0)
        rig.farmer.animate(dt, moving)
      }
      for (const [id, rig] of rigs) {
        if (!live.has(id)) {
          scene.remove(rig.farmer.root)
          rigs.delete(id)
        }
      }
    },
  }
}
