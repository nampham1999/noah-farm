import type { GameState } from '../core/state.ts'
import { isWater, TOM_SPOT, VILLAGE } from '../core/world.ts'

/**
 * Dân làng ngoài đời (chỉ để hiển thị, không lưu): ai đang có đơn hàng thì đi loanh quanh
 * gần bảng đơn hàng; Ông Tom luôn đứng câu cá ở đầu cầu.
 */

export interface NpcPose {
  x: number
  z: number
  rotY: number
  speed01: number
  tx: number
  tz: number
  wait: number
}

const WALK = 0.9
const poses = new Map<string, NpcPose>()

/** Những dân làng đang có mặt: Ông Tom và người có đơn hàng. */
export function presentNpcs(state: GameState): string[] {
  return [...new Set(['tom', ...state.orders.list.map((o) => o.npc)])]
}

export function npcPose(id: string): NpcPose | undefined {
  return poses.get(id)
}

function villagePoint(): { x: number; z: number } {
  for (;;) {
    const a = Math.random() * Math.PI * 2
    const d = Math.sqrt(Math.random()) * VILLAGE.r
    const x = VILLAGE.x + Math.cos(a) * d
    const z = VILLAGE.z + Math.sin(a) * d
    if (!isWater(x, z, 0.6)) return { x, z }
  }
}

export function updateNpcs(state: GameState, dt: number): void {
  const present = presentNpcs(state)
  for (const id of present) {
    let p = poses.get(id)
    if (!p) {
      const s = id === 'tom' ? { x: TOM_SPOT.x, z: TOM_SPOT.z } : villagePoint()
      p = { x: s.x, z: s.z, rotY: id === 'tom' ? TOM_SPOT.rotY : Math.random() * 6.28, speed01: 0, tx: s.x, tz: s.z, wait: Math.random() * 3 }
      poses.set(id, p)
    }
    if (id === 'tom') continue
    const dx = p.tx - p.x
    const dz = p.tz - p.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.1) {
      p.speed01 = 0
      p.wait -= dt
      if (p.wait <= 0) {
        const n = villagePoint()
        Object.assign(p, { tx: n.x, tz: n.z, wait: 3 + Math.random() * 6 })
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
  for (const id of poses.keys()) if (!present.includes(id)) poses.delete(id)
}

/** Dân làng dừng lại, quay mặt về phía người chơi khi được bắt chuyện. */
export function faceTowards(id: string, x: number, z: number, seconds: number): void {
  const p = poses.get(id)
  if (!p) return
  if (id !== 'tom') Object.assign(p, { tx: p.x, tz: p.z, wait: Math.max(p.wait, seconds) })
  p.rotY = Math.atan2(x - p.x, z - p.z)
}
