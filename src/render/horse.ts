import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { HITCH, horsePose } from '../systems/riding.ts'
import type { Models } from './assets.ts'

export interface HorseView {
  /** Độ cao yên ngựa (m), để nhân vật ngồi đúng chỗ. */
  saddleY: number
  update(state: GameState, time: number, dt: number): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

/** Chiều cao ngựa (tới đỉnh đầu), tính bằng mét. */
const HORSE_HEIGHT = 1.75

/** Ngựa: phi nước kiệu theo tốc độ, vẫy đuôi; cột buộc ngựa cạnh chuồng. */
export function createHorseView(scene: THREE.Scene, models: Models): HorseView {
  const root = new THREE.Group()
  const horse = models.horse.scene.clone()
  const box = new THREE.Box3().setFromObject(horse)
  const scale = HORSE_HEIGHT / Math.max(0.01, box.max.y - box.min.y)
  horse.scale.setScalar(scale)
  horse.position.y = -box.min.y * scale
  root.add(horse)
  const legs: THREE.Object3D[] = []
  let tail: THREE.Object3D | undefined
  let head: THREE.Object3D | undefined
  horse.traverse((o) => {
    if (/_Leg_/.test(o.name)) legs.push(o)
    if (o.name === 'Horse_Tail') tail = o
    if (o.name === 'Horse_Neck') head = o
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  root.visible = false
  scene.add(root)

  // Cột buộc ngựa: hai cọc và thanh ngang.
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const hitch = new THREE.Group()
  for (const dx of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), wood)
    post.position.set(dx, 0.55, 0)
    hitch.add(post)
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), wood)
  bar.position.y = 0.95
  hitch.add(bar)
  hitch.position.set(HITCH.x, 0, HITCH.z - 0.9)
  hitch.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  hitch.visible = false
  scene.add(hitch)

  let phase = 0
  const v = new THREE.Vector3()
  return {
    // Lưng ngựa khoảng 62% chiều cao.
    saddleY: HORSE_HEIGHT * 0.6,
    update(state, time, dt) {
      root.visible = hitch.visible = state.horse
      if (!state.horse) return
      const p = horsePose()
      root.position.set(p.x, 0, p.z)
      root.rotation.y = p.rotY
      phase += dt * (3 + 12 * p.speed01)
      const swing = Math.sin(phase) * 0.8 * p.speed01
      legs.forEach((leg, i) => (leg.rotation.x = i % 2 ? swing : -swing))
      root.position.y = Math.abs(Math.sin(phase)) * 0.08 * p.speed01
      if (tail) tail.rotation.x = 0.2 + Math.sin(time * 2.2) * 0.15
      if (head) head.rotation.x = p.speed01 > 0.1 ? Math.sin(phase) * 0.08 : Math.sin(time * 0.7) * 0.05
    },
    hitTest(camera, x, y) {
      if (!root.visible) return false
      v.copy(root.position).setY(0.9).project(camera)
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 55
    },
  }
}
