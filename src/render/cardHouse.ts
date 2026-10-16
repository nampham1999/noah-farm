import * as THREE from 'three'
import { CARD_HOUSE } from '../core/world.ts'
import { createSign } from './animals.ts'

export interface CardHouseView {
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

/** Khu giải trí: chòi tròn mái đỏ, bàn xanh có mấy lá bài, biển 🃏. */
export function createCardHouse(scene: THREE.Scene): CardHouseView {
  const group = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.15, 16), new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 1 }))
  floor.position.y = 0.07
  group.add(floor)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.4, 6), wood)
    post.position.set(Math.cos(a) * 1.85, 1.35, Math.sin(a) * 1.85)
    group.add(post)
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.3, 12), new THREE.MeshStandardMaterial({ color: 0xc8372d, roughness: 0.9 }))
  roof.position.y = 3.05
  group.add(roof)
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x23804a, roughness: 1 }))
  table.position.y = 0.85
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.75, 8), wood)
  leg.position.y = 0.45
  group.add(table, leg)
  const cardMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.8 })
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.32), cardMat)
    c.position.set(Math.cos(k * 1.6) * 0.35, 0.91, Math.sin(k * 1.6) * 0.35)
    c.rotation.y = k * 0.9
    group.add(c)
  }
  const sign = createSign('🃏')
  sign.position.y = 3.9
  sign.scale.setScalar(1.2)
  group.add(sign)
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  group.position.set(CARD_HOUSE.x, 0, CARD_HOUSE.z)
  scene.add(group)
  const v = new THREE.Vector3()
  return {
    hitTest(camera, x, y) {
      v.set(CARD_HOUSE.x, 1.5, CARD_HOUSE.z).project(camera)
      if (v.z > 1) return false
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 80
    },
  }
}
