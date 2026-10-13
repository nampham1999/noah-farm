import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { petIsPettedToday, petPose } from '../systems/pet.ts'
import { emojiTexture } from './animals.ts'
import type { Models } from './assets.ts'

export interface PetView {
  update(state: GameState, time: number): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

const DOG_SCALE = 1.1

/** Chó: bước chân, vẫy đuôi, đứng lâu thì ngồi; bong bóng 🎁 khi có quà, ❤️ lúc vừa vuốt ve. */
export function createPetView(scene: THREE.Scene, models: Models): PetView {
  const root = new THREE.Group()
  const dog = models.dog.scene.clone()
  dog.scale.setScalar(DOG_SCALE)
  root.add(dog)
  const legs: THREE.Object3D[] = []
  let tail: THREE.Object3D | undefined
  dog.traverse((o) => {
    if (/_Leg_/.test(o.name)) legs.push(o)
    if (o.name === 'Dog_Tail') tail = o
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  const back = legs.filter((l) => /_B[LR]$/.test(l.name))
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
  bubble.scale.set(0.5, 0.5, 1)
  bubble.position.y = 1.15
  bubble.visible = false
  root.add(bubble)
  root.visible = false
  scene.add(root)

  let phase = 0
  let lastTime = 0
  let icon = ''
  let wasPetted = false
  let heartUntil = 0
  const v = new THREE.Vector3()
  return {
    update(state, time) {
      const dt = Math.min(0.1, time - lastTime)
      lastTime = time
      root.visible = state.pet !== null
      if (!state.pet) return
      const p = petPose()
      root.position.set(p.x, 0, p.z)
      root.rotation.y = p.rotY
      phase += dt * (4 + 10 * p.speed01)
      const swing = Math.sin(phase) * 0.7 * p.speed01
      legs.forEach((leg, i) => (leg.rotation.x = i % 2 ? swing : -swing))
      // Ngồi: hạ phần sau, gập chân sau.
      const sit = p.sitting ? 1 : 0
      dog.rotation.x += (-0.35 * sit - dog.rotation.x) * Math.min(1, dt * 6)
      for (const l of back) l.rotation.x += -1.1 * sit
      if (tail) tail.rotation.y = Math.sin(time * (p.speed01 > 0.1 ? 14 : 8)) * 0.5
      root.position.y = Math.abs(Math.sin(phase)) * 0.05 * p.speed01

      const petted = petIsPettedToday(state)
      if (petted && !wasPetted) heartUntil = time + 2
      wasPetted = petted
      const next = state.pet.gift ? '🎁' : time < heartUntil ? '❤️' : ''
      if (next !== icon) {
        icon = next
        bubble.visible = icon !== ''
        if (icon) {
          const mat = bubble.material as THREE.SpriteMaterial
          mat.map = emojiTexture(icon)
          mat.needsUpdate = true
        }
      }
      bubble.position.y = 1.15 + Math.sin(time * 3) * 0.05
    },
    hitTest(camera, x, y) {
      if (!root.visible) return false
      v.copy(root.position).setY(0.4).project(camera)
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 45
    },
  }
}
