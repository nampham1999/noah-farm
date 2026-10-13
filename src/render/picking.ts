import * as THREE from 'three'
import { STALL } from '../core/world.ts'

export interface Pick {
  /** Điểm chạm trên mặt đất (y = 0). */
  x: number
  z: number
  /** Chạm trúng quầy hàng (kể cả phần mái và mặt quầy). */
  onStall: boolean
}

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const hit = new THREE.Vector3()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
/** Các độ cao dùng để thử xem tia có đi qua thân quầy hàng không. */
const STALL_HEIGHTS = [0, 0.9, 1.8]

/** Đổi điểm chạm trên màn hình sang điểm trên mặt đất. */
export function pickGround(camera: THREE.Camera, screenX: number, screenY: number): Pick | null {
  ndc.set((screenX / window.innerWidth) * 2 - 1, -(screenY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)

  let onStall = false
  for (const h of STALL_HEIGHTS) {
    ground.constant = -h
    if (raycaster.ray.intersectPlane(ground, hit) && Math.hypot(hit.x - STALL.x, hit.z - STALL.z) < STALL.r) {
      onStall = true
      break
    }
  }

  ground.constant = 0
  if (!raycaster.ray.intersectPlane(ground, hit)) return null
  return { x: hit.x, z: hit.z, onStall }
}
