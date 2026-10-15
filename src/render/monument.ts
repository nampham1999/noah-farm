import * as THREE from 'three'
import { MONUMENT } from '../core/world.ts'
import { createSign } from './animals.ts'
import type { Models } from './assets.ts'
import { staticModel } from './instancing.ts'

export interface MonumentView {
  update(level: number, time: number): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

/** Công trình chung của làng ở quảng trường, theo cấp: biển 🏗️ → đài phun nước → cối xay gió → tượng gà vàng. */
export function createMonument(scene: THREE.Scene, models: Models): MonumentView {
  const root = new THREE.Group()
  root.position.set(MONUMENT.x, 0, MONUMENT.z)
  scene.add(root)

  // Nền lát đá tròn cho quảng trường.
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 1 }))
  plaza.rotation.x = -Math.PI / 2
  plaza.position.y = 0.025
  plaza.receiveShadow = true
  root.add(plaza)

  const sign = createSign('🏗️')
  const stone = new THREE.MeshStandardMaterial({ color: 0xbfb4a0, roughness: 0.9 })

  // Cấp 1: đài phun nước, tia nước nhấp nhô.
  const fountain = new THREE.Group()
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.45, 20), stone)
  basin.position.y = 0.22
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x5ec3e8, roughness: 0.2 }))
  water.position.y = 0.46
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.1, 10), stone)
  pillar.position.y = 0.95
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.2, 14), stone)
  bowl.position.y = 1.5
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.7 }))
  jet.position.y = 1.85
  fountain.add(basin, water, pillar, bowl, jet)

  // Cấp 2: cối xay gió.
  const windmill = staticModel(models.windmill.scene)
  const box = new THREE.Box3().setFromObject(windmill)
  windmill.scale.setScalar(3.4 / Math.max(0.01, box.max.y - box.min.y))

  // Cấp 3: tượng gà vàng trên bệ đá.
  const statue = new THREE.Group()
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), stone)
  pedestal.position.y = 0.4
  const chicken = models.chicken.scene.clone()
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc93a, metalness: 0.7, roughness: 0.25 })
  chicken.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = gold
  })
  chicken.scale.setScalar(2.4)
  chicken.position.y = 0.8
  statue.add(pedestal, chicken)

  const stages = [sign, fountain, windmill, statue]
  for (const s of stages) {
    s.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    s.visible = false
    root.add(s)
  }

  const v = new THREE.Vector3()
  return {
    update(level, time) {
      stages.forEach((s, i) => (s.visible = i === Math.min(level, stages.length - 1)))
      if (level === 1) {
        jet.scale.y = 1 + Math.sin(time * 6) * 0.15
        water.position.y = 0.46 + Math.sin(time * 2) * 0.01
      }
      if (level >= 3) chicken.rotation.y = Math.sin(time * 0.5) * 0.3
    },
    hitTest(camera, x, y) {
      v.set(MONUMENT.x, 1, MONUMENT.z).project(camera)
      if (v.z > 1) return false
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 60
    },
  }
}
