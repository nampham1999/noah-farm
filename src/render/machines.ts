import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { item, MACHINES, type MachineId } from '../data/index.ts'
import { machineStatus } from '../systems/machines.ts'
import { createSign, emojiTexture } from './animals.ts'
import { loadFurniture, type Models } from './assets.ts'
import { staticModel } from './instancing.ts'

export interface MachinesView {
  update(state: GameState, t: number, time: number): void
  /** Máy (hoặc biển chờ mua) dưới điểm chạm trên màn hình. */
  hitTest(camera: THREE.Camera, x: number, y: number): MachineId | null
}

/** Chiều cao mong muốn của từng máy (m), để mô hình nào cũng vừa cỡ nhân vật. */
const HEIGHT: Record<MachineId, number> = { preserves: 0.9, stove: 1.0, beehive: 1.2 }

interface Slot {
  sign: THREE.Group
  model: THREE.Object3D | null
  bubble: THREE.Sprite
  icon: string
}

/** Góc xưởng cạnh nhà: hũ ủ, bếp, tổ ong; chưa mua thì là tấm biển. */
export function createMachinesView(scene: THREE.Scene, models: Models): MachinesView {
  const slots = new Map<MachineId, Slot>()
  for (const def of MACHINES) {
    const sign = createSign(def.icon)
    if (def.inRestaurant) sign.visible = false
    sign.position.set(def.x, 0, def.z)
    scene.add(sign)
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
    bubble.scale.set(0.55, 0.55, 1)
    bubble.visible = false
    scene.add(bubble)
    slots.set(def.id, { sign, model: null, bubble, icon: '' })
  }

  const place = (id: MachineId, source: THREE.Object3D) => {
    const def = MACHINES.find((m) => m.id === id)!
    const model = staticModel(source)
    const box = new THREE.Box3().setFromObject(model)
    model.scale.setScalar(HEIGHT[id] / Math.max(0.01, box.max.y - box.min.y))
    model.position.set(def.x, 0, def.z)
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    scene.add(model)
    slots.get(id)!.model = model
  }
  let stoveLoading = false

  const v = new THREE.Vector3()
  return {
    update(state, t, time) {
      for (const def of MACHINES) {
        const slot = slots.get(def.id)!
        const status = machineStatus(state, def.id, t)
        const owned = status !== 'missing'
        slot.sign.visible = !owned && !def.inRestaurant
        if (def.inRestaurant) {
          // Bếp trong nhà hàng: chỉ hiện bong bóng đang nấu / xong ở trước cửa.
          const m0 = state.machines.find((x) => x.id === def.id)
          const icon0 = status === 'ready' && m0?.output ? item(m0.output).icon : status === 'working' ? '⏳' : ''
          if (icon0 !== slot.icon) {
            slot.icon = icon0
            slot.bubble.visible = icon0 !== ''
            if (icon0) {
              const mat0 = slot.bubble.material as THREE.SpriteMaterial
              mat0.map = emojiTexture(icon0)
              mat0.needsUpdate = true
            }
          }
          slot.bubble.position.set(def.x, 2.4 + Math.sin(time * 3) * 0.05, def.z)
          continue
        }
        if (owned && !slot.model) {
          if (def.id === 'preserves') place('preserves', models.jamJar.scene)
          else if (def.id === 'beehive') place('beehive', models.beehive.scene)
          else if (!stoveLoading) {
            // Bếp nằm trong bộ nội thất (tải lúc cần).
            stoveLoading = true
            void loadFurniture().then((g) => {
              const stove = g.scene.getObjectByName('Furn_stove')
              if (stove) place('stove', stove)
            })
          }
        }
        // Xong thì hiện sản phẩm, đang làm thì hiện đồng hồ cát.
        const m = state.machines.find((x) => x.id === def.id)
        const icon = status === 'ready' && m?.output ? item(m.output).icon : status === 'working' && def.id !== 'beehive' ? '⏳' : ''
        if (icon !== slot.icon) {
          slot.icon = icon
          slot.bubble.visible = icon !== ''
          if (icon) {
            const mat = slot.bubble.material as THREE.SpriteMaterial
            mat.map = emojiTexture(icon)
            mat.needsUpdate = true
          }
        }
        slot.bubble.position.set(def.x, HEIGHT[def.id] + 0.55 + Math.sin(time * 3 + def.x) * 0.05, def.z)
      }
    },
    hitTest(camera, x, y) {
      let best: MachineId | null = null
      let bestD = 50
      for (const def of MACHINES) {
        v.set(def.x, 0.6, def.z).project(camera)
        if (v.z > 1) continue
        const d = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y)
        if (d < bestD) {
          bestD = d
          best = def.id
        }
      }
      return best
    },
  }
}
