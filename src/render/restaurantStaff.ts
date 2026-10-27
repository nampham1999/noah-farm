import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RESTAURANT } from '../core/world.ts'
import { NPCS } from '../systems/orders.ts'
import { staffWalk } from '../systems/restaurant.ts'
import { createCharacter } from './character.ts'
import type { Farmer } from './models.ts'

export interface StaffView {
  update(state: GameState, dt: number, time: number, nowMs: number): void
}

interface Rig {
  farmer: Farmer
  role: 'chef' | 'waiter'
  home: { x: number; z: number }
  look: number
}

const WALK_SPEED = 2.6
const FRONT_Z = RESTAURANT.z + RESTAURANT.d / 2

/** Nhân viên nhà hàng: đầu bếp đứng cạnh cửa sổ bếp, người phục vụ đi từ cửa ra tận bàn khách rồi quay về chỗ cũ. */
export function createStaffView(scene: THREE.Scene): StaffView {
  const rigs = new Map<number, Rig>()

  return {
    update(state, dt, time, nowMs) {
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
          const home = chef ? { x: RESTAURANT.x - 3.3 + slot * 1.5, z: FRONT_Z + 1.1 } : { x: RESTAURANT.x + 2.1 + slot * 1.5, z: FRONT_Z + 1.9 }
          farmer.root.position.set(home.x, 0, home.z)
          scene.add(farmer.root)
          rig = { farmer, role: sf.role, home, look: sf.look }
          rigs.set(sf.id, rig)
        }
        const root = rig.farmer.root
        root.visible = outdoors
        if (!outdoors) continue
        // Người phục vụ đang có việc thì đi tới bàn khách, xong thì về chỗ.
        const walk = staffWalk.get(sf.id)
        const goal = walk && walk.until > nowMs ? { x: walk.x + 0.9, z: walk.z + 0.2 } : rig.home
        const dx = goal.x - root.position.x
        const dz = goal.z - root.position.z
        const dist = Math.hypot(dx, dz)
        let moving = 0
        if (!chef && dist > 0.08) {
          const step = Math.min(dist, WALK_SPEED * dt)
          root.position.x += (dx / dist) * step
          root.position.z += (dz / dist) * step
          root.rotation.y = Math.atan2(dx, dz)
          moving = 0.6
        } else root.rotation.y = chef ? 0 : walk && walk.until > nowMs ? -Math.PI / 2 : 0
        rig.farmer.animate(dt, moving)
        // Đầu bếp đang nấu thì nhún nhẹ như đang làm việc.
        root.position.y = chef && sf.cooking ? Math.abs(Math.sin(time * 6 + sf.id)) * 0.08 : 0
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
