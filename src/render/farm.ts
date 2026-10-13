import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState, PlotState } from '../core/state.ts'
import { PLOT_AREA, plotCenter } from '../core/world.ts'
import { cropOf, isRipe, needsWater } from '../systems/farming.ts'
import { instanceModel, placeMatrix, type InstancedModel } from './instancing.ts'

const GRASS = new THREE.Color(0xb3e07a)
const DRY = new THREE.Color(0xa86f3e)
const WET = new THREE.Color(0x6e4626)

export interface FarmView {
  /** Cập nhật từ kho trạng thái; 16 ô nên làm mỗi khung hình vẫn rẻ. */
  update(state: GameState, focus: PlotState | null, time: number): void
}

/** Tên mô hình trong crops.glb cho từng giai đoạn: hạt, mầm, đang lớn, chín. */
function cropVariant(model: string, stage: number, ripe: boolean): string {
  if (ripe) return `${model}_3`
  return ['seeds', 'sprout', `${model}_2`][Math.min(stage, 2)]
}

/** Ô đất, cây trồng (mô hình của bản cũ), dấu "cần tưới" và khung tô sáng ô đang nhắm. */
export function createFarmView(scene: THREE.Scene, crops: GLTF): FarmView {
  const n = PLOT_AREA.cols * PLOT_AREA.rows
  const size = PLOT_AREA.size * 0.9

  const soil = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, 0.1, size),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    n,
  )
  soil.receiveShadow = true
  soil.frustumCulled = false

  const drops = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0x4fb3ff, emissive: 0x1a5fa0, roughness: 0.3 }),
    n,
  )
  drops.frustumCulled = false

  const highlight = new THREE.Mesh(
    // Vòng 4 cạnh xoay 45° thành khung vuông; nhân √2 để bán kính bằng nửa cạnh.
    new THREE.RingGeometry(size * 0.5, size * 0.58, 4, 1, Math.PI / 4),
    new THREE.MeshBasicMaterial({ color: 0xfff6e3, transparent: true, opacity: 0.9 }),
  )
  highlight.rotation.x = -Math.PI / 2
  highlight.scale.set(Math.SQRT2, Math.SQRT2, 1)
  scene.add(soil, drops, highlight)

  // Mỗi biến thể cây (vd. carrot_3) là một nhóm InstancedMesh, tạo khi cần lần đầu.
  const variants = new Map<string, { inst: InstancedModel; count: number }>()
  const variant = (name: string) => {
    let v = variants.get(name)
    if (!v) {
      const source = crops.scene.getObjectByName(`CropRoot_${name}`) ?? crops.scene.getObjectByName('CropRoot_sprout')!
      v = { inst: instanceModel(source, n, { shadows: true }), count: 0 }
      variants.set(name, v)
      scene.add(v.inst.group)
    }
    return v
  }

  const m = new THREE.Matrix4()
  const dropPos = new THREE.Vector3()
  const dropRot = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  return {
    update(state, focus, time) {
      for (const v of variants.values()) v.count = 0
      let nDrops = 0

      state.plots.forEach((plot, i) => {
        const c = plotCenter(plot.x, plot.z)
        soil.setMatrixAt(i, m.makeTranslation(c.x, 0.05, c.z))
        soil.setColorAt(i, !plot.tilled ? GRASS : plot.crop && plot.wateredAt !== null ? WET : DRY)

        const crop = cropOf(plot)
        if (!crop) return
        const v = variant(cropVariant(crop.model, plot.stage, isRipe(plot)))
        // Lắc nhẹ theo gió, lệch pha theo vị trí ô.
        const sway = Math.sin(time * 1.5 + i) * 0.05
        v.inst.setMatrixAt(v.count++, placeMatrix(c.x, c.z, plot.x * 1.3 + plot.z * 0.7 + sway, 1, 0.1, m))

        if (needsWater(plot)) {
          dropPos.set(c.x, 1.1 + Math.sin(time * 3 + i) * 0.08, c.z)
          dropRot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 2)
          drops.setMatrixAt(nDrops++, m.compose(dropPos, dropRot, one))
        }
      })

      for (const v of variants.values()) {
        v.inst.setCount(v.count)
        v.inst.commit()
      }
      drops.count = nDrops
      drops.instanceMatrix.needsUpdate = true
      soil.instanceMatrix.needsUpdate = true
      if (soil.instanceColor) soil.instanceColor.needsUpdate = true

      highlight.visible = focus !== null
      if (focus) {
        const c = plotCenter(focus.x, focus.z)
        highlight.position.set(c.x, 0.12, c.z)
        ;(highlight.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(time * 5) * 0.25
      }
    },
  }
}
