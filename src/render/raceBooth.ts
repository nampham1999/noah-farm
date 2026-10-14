import * as THREE from 'three'
import { RACE_BOOTH } from '../core/world.ts'
import { createSign } from './animals.ts'

export interface RaceBoothView {
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

/** Quầy trường đua chó: tấm biển 🐕🏁 và hai cột cờ nhỏ. */
export function createRaceBooth(scene: THREE.Scene): RaceBoothView {
  const group = new THREE.Group()
  const sign = createSign('🐕🏁')
  sign.scale.setScalar(1.3)
  group.add(sign)
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const colors = [0xe2483a, 0xffc93a]
  for (const [i, dx] of [-0.9, 0.9].entries()) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6), wood)
    pole.position.set(dx, 0.9, 0)
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide }))
    flag.position.set(dx + 0.25, 1.62, 0)
    group.add(pole, flag)
  }
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  group.position.set(RACE_BOOTH.x, 0, RACE_BOOTH.z)
  scene.add(group)
  const v = new THREE.Vector3()
  return {
    hitTest(camera, x, y) {
      v.set(RACE_BOOTH.x, 1, RACE_BOOTH.z).project(camera)
      if (v.z > 1) return false
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 60
    },
  }
}
