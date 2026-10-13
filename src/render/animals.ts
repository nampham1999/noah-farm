import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { COOP } from '../core/world.ts'
import { item } from '../data/index.ts'
import { animalDef, animalPose, isHungry, isReady } from '../systems/animals.ts'
import type { Models } from './assets.ts'
import { staticModel } from './instancing.ts'

export interface AnimalsView {
  update(state: GameState, t: number, time: number, dt: number, riddenId: string | null): void
  /** Vị trí trên màn hình của từng con, để chạm chọn. */
  hitTest(camera: THREE.Camera, x: number, y: number): string | null
}

interface Rig {
  root: THREE.Group
  legs: THREE.Object3D[]
  bubble: THREE.Sprite
  bubbleIcon: string
  phase: number
  heartUntil: number
}

const LEG_NAME = /_Leg_/

/** Vật nuôi đi lại quanh chuồng, chuồng theo cấp, và biển "Chuồng" khi chưa xây. */
export function createAnimalsView(scene: THREE.Scene, models: Models): AnimalsView {
  const rigs = new Map<string, Rig>()

  const coop1 = staticModel(models.coop.scene)
  const coop2 = staticModel(models.cowbarn.scene)
  for (const c of [coop1, coop2]) {
    c.position.set(COOP.x, 0, COOP.z)
    c.visible = false
    scene.add(c)
  }
  const sign = createSign()
  sign.position.set(COOP.x, 0, COOP.z + 1.6)
  scene.add(sign)

  const modelFor = { chicken: models.chicken, pig: models.pig, cow: models.cow }
  const v = new THREE.Vector3()
  const lastPetted = new Map<string, number>()
  let ridden: string | null = null

  return {
    update(state, t, time, dt, riddenId) {
      ridden = riddenId
      coop1.visible = state.coopLevel === 1
      coop2.visible = state.coopLevel >= 2
      sign.visible = state.coopLevel === 0

      for (const a of state.animals) {
        let rig = rigs.get(a.id)
        if (!rig) {
          const root = new THREE.Group()
          const body = modelFor[a.type].scene.clone()
          body.scale.setScalar(animalDef(a).scale)
          root.add(body)
          const legs: THREE.Object3D[] = []
          body.traverse((o) => {
            if (LEG_NAME.test(o.name)) legs.push(o)
            if (o instanceof THREE.Mesh) o.castShadow = true
          })
          const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
          bubble.scale.set(0.55, 0.55, 1)
          // Chưa có biểu tượng thì ẩn, nếu không sprite trống hiện thành ô vuông trắng.
          bubble.visible = false
          bubble.position.y = 1.1 * animalDef(a).scale + 0.3
          root.add(bubble)
          rig = { root, legs, bubble, bubbleIcon: '', phase: Math.random() * 6, heartUntil: 0 }
          rigs.set(a.id, rig)
          scene.add(root)
        }
        const p = animalPose(a.id)
        if (p) {
          rig.root.position.set(p.x, 0, p.z)
          rig.root.rotation.y = p.rotY
          rig.phase += dt * (3 + 7 * p.speed01)
          const swing = Math.sin(rig.phase) * 0.6 * p.speed01
          rig.legs.forEach((leg, i) => (leg.rotation.x = i % 2 ? swing : -swing))
          rig.root.position.y = Math.abs(Math.sin(rig.phase)) * 0.04 * p.speed01
        }
        // Vừa được vuốt ve thì hiện tim một lúc.
        if (lastPetted.get(a.id) !== undefined && lastPetted.get(a.id) !== a.pettedDay) rig.heartUntil = time + 2
        lastPetted.set(a.id, a.pettedDay)

        const icon = a.id === riddenId ? '' : time < rig.heartUntil ? '❤️' : isReady(a) ? item(animalDef(a).product).icon : isHungry(a, t) ? '🌾' : ''
        if (icon !== rig.bubbleIcon) {
          rig.bubbleIcon = icon
          rig.bubble.visible = icon !== ''
          if (icon) (rig.bubble.material as THREE.SpriteMaterial).map = emojiTexture(icon)
          ;(rig.bubble.material as THREE.SpriteMaterial).needsUpdate = true
        }
        rig.bubble.position.y = 1.1 * animalDef(a).scale + 0.3 + Math.sin(time * 3 + rig.phase) * 0.05
      }
      for (const [id, rig] of rigs) {
        if (!state.animals.some((a) => a.id === id)) {
          scene.remove(rig.root)
          rigs.delete(id)
        }
      }
    },

    hitTest(camera, x, y) {
      let best: string | null = null
      let bestD = 48
      for (const [id, rig] of rigs) {
        if (id === ridden) continue
        v.copy(rig.root.position).setY(0.4).project(camera)
        const sx = ((v.x + 1) / 2) * window.innerWidth
        const sy = ((1 - v.y) / 2) * window.innerHeight
        const d = Math.hypot(sx - x, sy - y)
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      return best
    },
  }
}

const emojiCache = new Map<string, THREE.Texture>()

/** Bong bóng tròn trắng có emoji ở giữa, vẽ bằng canvas. */
export function emojiTexture(emoji: string): THREE.Texture {
  let tex = emojiCache.get(emoji)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  // Nền vàng kem để trứng, sữa (màu trắng) vẫn nổi rõ.
  g.fillStyle = 'rgba(255,226,140,0.97)'
  g.strokeStyle = '#b06e33'
  g.lineWidth = 8
  g.beginPath()
  g.arc(64, 60, 50, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(emoji, 64, 64)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  emojiCache.set(emoji, tex)
  return tex
}

/** Tấm biển gỗ đánh dấu chỗ xây chuồng. */
function createSign(): THREE.Group {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), wood)
  post.position.y = 0.55
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#d9a15e'
  ctx.fillRect(0, 0, 128, 64)
  ctx.font = '40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('🐔🏠', 64, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.06), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex }), wood])
  board.position.y = 1.0
  post.castShadow = board.castShadow = true
  g.add(post, board)
  return g
}
