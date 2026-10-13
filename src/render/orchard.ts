import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { ORCHARD, TREE_BY_ID, type TreeId } from '../data/index.ts'
import { treeGrowth, treeStatus } from '../systems/orchard.ts'
import { emojiTexture } from './animals.ts'
import type { Models } from './assets.ts'
import { staticModel } from './instancing.ts'

export interface OrchardView {
  update(state: GameState, t: number, time: number): void
  /** Ô vườn dưới điểm chạm; -1 nếu không trúng. */
  hitTest(camera: THREE.Camera, x: number, y: number): number
}

/** Chiều cao cây trưởng thành (m). */
const TREE_HEIGHT = 3.4

interface Spot {
  patch: THREE.Mesh
  stake: THREE.Mesh
  tree: THREE.Object3D | null
  type: TreeId | null
  bubble: THREE.Sprite
  icon: string
}

/** Ô vườn: chưa trồng là khoảnh đất có cọc; trồng rồi là cây lớn dần, có quả thì hiện bong bóng. */
export function createOrchardView(scene: THREE.Scene, models: Models): OrchardView {
  const soil = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 1 })
  const wood = new THREE.MeshStandardMaterial({ color: 0xb08050, roughness: 1 })
  const spots: Spot[] = ORCHARD.spots.map((p) => {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), soil)
    patch.rotation.x = -Math.PI / 2
    patch.position.set(p.x, 0.025, p.z)
    patch.receiveShadow = true
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), wood)
    stake.position.set(p.x + 0.35, 0.3, p.z)
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
    bubble.scale.set(0.6, 0.6, 1)
    bubble.visible = false
    scene.add(patch, stake, bubble)
    return { patch, stake, tree: null, type: null, bubble, icon: '' }
  })

  // Một khuôn đã chỉnh cỡ cho mỗi loại cây, nhân bản khi trồng.
  const templates = new Map<TreeId, THREE.Object3D>()
  const template = (type: TreeId) => {
    let tpl = templates.get(type)
    if (!tpl) {
      tpl = staticModel(models[TREE_BY_ID.get(type)!.model].scene)
      const box = new THREE.Box3().setFromObject(tpl)
      tpl.scale.setScalar(TREE_HEIGHT / Math.max(0.01, box.max.y - box.min.y))
      tpl.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true
      })
      templates.set(type, tpl)
    }
    return tpl
  }

  const v = new THREE.Vector3()
  return {
    update(state, t, time) {
      spots.forEach((spot, i) => {
        const tree = state.orchard.find((o) => o.spot === i)
        const p = ORCHARD.spots[i]
        if ((tree?.type ?? null) !== spot.type) {
          if (spot.tree) scene.remove(spot.tree)
          spot.tree = null
          spot.type = tree?.type ?? null
          if (tree) {
            const tpl = template(tree.type)
            spot.tree = tpl.clone()
            spot.tree.userData.full = tpl.scale.x
            spot.tree.position.set(p.x, 0, p.z)
            spot.tree.rotation.y = i * 1.7
            scene.add(spot.tree)
          }
        }
        spot.stake.visible = !tree
        if (spot.tree && tree) {
          // Cây con nhỏ, lớn dần tới cỡ thật.
          spot.tree.scale.setScalar(spot.tree.userData.full * (0.25 + 0.75 * treeGrowth(tree, t)))
        }
        const icon = tree && treeStatus(state, tree, t) === 'fruit' ? TREE_BY_ID.get(tree.type)!.icon : ''
        if (icon !== spot.icon) {
          spot.icon = icon
          spot.bubble.visible = icon !== ''
          if (icon) {
            const mat = spot.bubble.material as THREE.SpriteMaterial
            mat.map = emojiTexture(icon)
            mat.needsUpdate = true
          }
        }
        spot.bubble.position.set(p.x, TREE_HEIGHT + 0.5 + Math.sin(time * 3 + i) * 0.06, p.z)
      })
    },
    hitTest(camera, x, y) {
      let best = -1
      let bestD = 60
      ORCHARD.spots.forEach((p, i) => {
        v.set(p.x, 0.8, p.z).project(camera)
        if (v.z > 1) return
        const d = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    },
  }
}
