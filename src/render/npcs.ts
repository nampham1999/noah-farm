import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { ORDER_BOARD } from '../core/world.ts'
import { npcPose, presentNpcs } from '../systems/npcs.ts'
import { canDeliver, npcDef } from '../systems/orders.ts'
import type { Models } from './assets.ts'
import { createCharacter } from './character.ts'
import type { Farmer } from './models.ts'
import { staticModel } from './instancing.ts'
import { emojiTexture } from './animals.ts'

export interface NpcsView {
  update(state: GameState, dt: number, time: number): void
  hitTest(camera: THREE.Camera, x: number, y: number): string | null
}

interface Rig {
  farmer: Farmer
  bubble: THREE.Sprite
  icon: string
  top: number
}

/** Dân làng (nhân vật nhuộm màu, đội mũ riêng) và bảng đơn hàng. */
export function createNpcsView(scene: THREE.Scene, _models: Models): NpcsView {
  const rigs = new Map<string, Rig>()
  const board = createBoard()
  const boardMesh = staticModel(board)
  boardMesh.position.copy(board.position)
  boardMesh.rotation.copy(board.rotation)
  scene.add(boardMesh)
  const v = new THREE.Vector3()

  return {
    update(state, dt, time) {
      const present = presentNpcs(state)
      for (const id of present) {
        let rig = rigs.get(id)
        if (!rig) {
          const def = npcDef(id)
          const farmer = createCharacter(def.look)
          const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
          bubble.scale.set(0.6, 0.6, 1)
          // Bong bóng ngay trên đầu, theo chiều cao từng người (trẻ con thấp hơn).
          const top = def.look.age === 'child' ? 1.35 : def.look.hat === 'chef' ? 2.05 : 1.85
          bubble.position.y = top
          farmer.root.add(bubble)
          rig = { farmer, bubble, icon: '', top }
          rigs.set(id, rig)
          scene.add(farmer.root)
        }
        const p = npcPose(id)
        if (p) {
          rig.farmer.root.position.set(p.x, 0, p.z)
          rig.farmer.root.rotation.y = p.rotY
          rig.farmer.animate(dt, p.speed01 * 0.5)
        }
        // ❗ có thể giao hàng, 💬 đang chờ hàng, 🎣 Ông Tom lúc không đặt hàng.
        const order = state.orders.list.find((o) => o.npc === id)
        const icon = order ? (canDeliver(state, order) ? '❗' : '💬') : '🎣'
        if (icon !== rig.icon) {
          rig.icon = icon
          const m = rig.bubble.material as THREE.SpriteMaterial
          m.map = emojiTexture(icon)
          m.needsUpdate = true
        }
        rig.bubble.position.y = rig.top + Math.sin(time * 2.5 + id.length) * 0.06
      }
      for (const [id, rig] of rigs) {
        if (!present.includes(id)) {
          scene.remove(rig.farmer.root)
          rigs.delete(id)
        }
      }
    },

    hitTest(camera, x, y) {
      let best: string | null = null
      let bestD = 50
      for (const [id, rig] of rigs) {
        v.copy(rig.farmer.root.position).setY(0.8).project(camera)
        const d = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y)
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      return best
    },
  }
}

/** Bảng đơn hàng: khung gỗ trên hai chân, mái nhỏ, vài tờ giấy ghim. */
function createBoard(): THREE.Group {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const plank = new THREE.MeshStandardMaterial({ color: 0xc9915a, roughness: 1 })
  for (const x of [-0.65, 0.65]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), wood)
    leg.position.set(x, 0.9, 0)
    g.add(leg)
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.08), plank)
  panel.position.y = 1.2
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 1 }))
  roof.position.set(0, 1.78, 0.05)
  roof.rotation.x = -0.25
  g.add(panel, roof)
  const paperColors = [0xfff6e0, 0xfde9bf, 0xffffff]
  ;[[-0.4, 1.3], [0.05, 1.15], [0.45, 1.32]].forEach(([x, y], i) => {
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.42), new THREE.MeshStandardMaterial({ color: paperColors[i], roughness: 1 }))
    paper.position.set(x, y, 0.045)
    paper.rotation.z = (i - 1) * 0.08
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshStandardMaterial({ color: 0xe2483a }))
    pin.position.set(x, y + 0.17, 0.06)
    g.add(paper, pin)
  })
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  g.position.set(ORDER_BOARD.x, 0, ORDER_BOARD.z)
  // Mặt bảng quay về phía camera (nam), hơi nghiêng ra đường đất.
  g.rotation.y = 0.35
  return g
}
