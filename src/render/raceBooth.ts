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

/** Sạp chợ phiên: bàn gỗ có mái sọc và vài giỏ hàng. */
export function createMarketStall(scene: THREE.Scene, at: { x: number; z: number }): RaceBoothView {
  const group = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 1 })
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.8), wood)
  table.position.y = 0.8
  group.add(table)
  for (const [dx, dz] of [[-0.8, -0.32], [0.8, -0.32], [-0.8, 0.32], [0.8, 0.32]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), wood)
    leg.position.set(dx, 0.9, dz)
    group.add(leg)
  }
  const stripes = [0xe2483a, 0xfffaf0]
  for (let k = 0; k < 6; k++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 1.0), new THREE.MeshStandardMaterial({ color: stripes[k % 2], roughness: 0.9 }))
    stripe.position.set(-0.8 + k * 0.32, 1.82, 0)
    stripe.rotation.x = 0.15
    group.add(stripe)
  }
  const basket = new THREE.MeshStandardMaterial({ color: 0xc79a5e, roughness: 1 })
  const produce = [0xf08a24, 0xe2483a, 0x7cb342]
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.16, 10), basket)
    b.position.set(-0.55 + k * 0.55, 0.94, 0)
    const fill = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: produce[k] }))
    fill.position.set(-0.55 + k * 0.55, 1.0, 0)
    group.add(b, fill)
  }
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  group.position.set(at.x, 0, at.z)
  scene.add(group)
  const v = new THREE.Vector3()
  return {
    hitTest(camera, x, y) {
      v.set(at.x, 1, at.z).project(camera)
      if (v.z > 1) return false
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 60
    },
  }
}

