import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { GH_BED, GREENHOUSE } from '../core/world.ts'
import { createSign } from './animals.ts'
import type { Models } from './assets.ts'
import { staticModel } from './instancing.ts'

export interface GreenhouseView {
  update(state: GameState): void
}

/** Nhà kính (phóng to cho vừa cỡ), khung kính quanh luống ấm, và biển 🪴 khi chưa dựng. */
export function createGreenhouseView(scene: THREE.Scene, models: Models): GreenhouseView {
  const house = staticModel(models.greenhouse.scene)
  house.scale.setScalar(1.25)
  house.position.set(GREENHOUSE.x, 0, GREENHOUSE.z)
  house.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  house.visible = false

  // Khung gỗ thấp và tấm kính mờ quanh luống: nhìn là biết luống ấm.
  const frame = new THREE.Group()
  const w = GH_BED.cols * GH_BED.size + 0.4
  const d = GH_BED.rows * GH_BED.size + 0.4
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false })
  for (const [x, z, sx, sz] of [[0, -d / 2, w, 0.12], [0, d / 2, w, 0.12], [-w / 2, 0, 0.12, d], [w / 2, 0, 0.12, d]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.22, sz), wood)
    rail.position.set(x, 0.11, z)
    const pane = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.35, sz * 0.3), glass)
    pane.position.set(x, 0.39, z)
    frame.add(rail, pane)
  }
  frame.position.set(GH_BED.x, 0, GH_BED.z)
  frame.visible = false

  const sign = createSign('🪴')
  sign.position.set(GREENHOUSE.x, 0, GREENHOUSE.z + 1.6)
  scene.add(house, frame, sign)

  return {
    update(state) {
      house.visible = frame.visible = state.greenhouse
      sign.visible = !state.greenhouse
    },
  }
}
