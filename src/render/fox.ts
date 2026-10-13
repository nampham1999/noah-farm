import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { PEN } from '../core/world.ts'
import { fox } from '../systems/fox.ts'
import { emojiTexture } from './animals.ts'
import type { Models } from './assets.ts'

export interface FoxView {
  update(state: GameState, time: number, dt: number): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

/** Cáo lẻn vào ban đêm (có dấu ❗), và hàng rào tròn quanh bãi thả khi đã mua. */
export function createFoxView(scene: THREE.Scene, models: Models): FoxView {
  const root = new THREE.Group()
  const body = models.fox.scene.clone()
  body.scale.setScalar(1.1)
  root.add(body)
  const legs: THREE.Object3D[] = []
  let tail: THREE.Object3D | undefined
  body.traverse((o) => {
    if (/_Leg_/.test(o.name)) legs.push(o)
    if (o.name === 'Fox_Tail') tail = o
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  const alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('❗'), transparent: true, depthWrite: false }))
  alert.scale.set(0.5, 0.5, 1)
  alert.position.y = 1.2
  root.add(alert)
  root.visible = false
  scene.add(root)

  // Hàng rào quanh bãi thả: cọc và hai thanh ngang, chừa lối vào phía tây.
  const fence = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 1 })
  const r = PEN.r + 0.6
  const n = 22
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    // Lối vào: bỏ một nhịp phía tây (gần đường chính).
    if (Math.abs(Math.atan2(Math.sin(a0 - Math.PI), Math.cos(a0 - Math.PI))) < 0.2) continue
    const x0 = PEN.x + Math.cos(a0) * r
    const z0 = PEN.z + Math.sin(a0) * r
    const x1 = PEN.x + Math.cos(a1) * r
    const z1 = PEN.z + Math.sin(a1) * r
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), wood)
    post.position.set(x0, 0.4, z0)
    fence.add(post)
    const len = Math.hypot(x1 - x0, z1 - z0)
    for (const y of [0.35, 0.65]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.05), wood)
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
      rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
      fence.add(rail)
    }
  }
  fence.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  fence.visible = false
  scene.add(fence)

  let phase = 0
  const v = new THREE.Vector3()
  return {
    update(state, time, dt) {
      fence.visible = state.coopFence
      root.visible = fox.phase !== 'none' && !state.player.indoors
      if (!root.visible) return
      root.position.set(fox.x, 0, fox.z)
      root.rotation.y = fox.rotY
      const speed = fox.phase === 'flee' ? 1 : 0.5
      phase += dt * 14 * speed
      const swing = Math.sin(phase) * 0.7 * speed
      legs.forEach((leg, i) => (leg.rotation.x = i % 2 ? swing : -swing))
      if (tail) tail.rotation.y = Math.sin(time * 6) * 0.3
      alert.visible = fox.phase === 'sneak'
      alert.position.y = 1.2 + Math.sin(time * 5) * 0.06
    },
    hitTest(camera, x, y) {
      if (!root.visible || fox.phase !== 'sneak') return false
      v.copy(root.position).setY(0.4).project(camera)
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 55
    },
  }
}
