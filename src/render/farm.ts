import * as THREE from 'three'
import { mulberry32 } from '../core/random.ts'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState, PlotState } from '../core/state.ts'
import { blockCells, blockCenter, GH_BED, LAND_BLOCKS, PLOT_AREA, plotCenter, SCARECROW } from '../core/world.ts'
import { nextLandPrice } from '../systems/land.ts'
import { cropOf, isRipe, needsWater } from '../systems/farming.ts'
import { instanceModel, placeMatrix, staticModel, type InstancedModel } from './instancing.ts'

/** Đất khô giữ màu gốc của texture; đất ướt nhân màu tối hơn. */
const DRY = new THREE.Color(0xffffff)
const WET = new THREE.Color(0x8a7468)

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
  // Mọi khu ruộng cộng luống nhà kính.
  const n = PLOT_AREA.cols * PLOT_AREA.rows * LAND_BLOCKS.length + GH_BED.cols * GH_BED.rows
  const size = PLOT_AREA.size * 0.9

  // Đất đã cuốc: khối đất có luống (texture vẽ bằng canvas).
  const soil = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, 0.12, size),
    new THREE.MeshStandardMaterial({ map: soilTexture(), roughness: 1 }),
    n,
  )
  soil.receiveShadow = true
  soil.frustumCulled = false

  // Ô chưa cuốc: chỉ viền mờ trên cỏ để biết chỗ nào trồng được.
  const outlinePlane = new THREE.PlaneGeometry(size, size)
  outlinePlane.rotateX(-Math.PI / 2)
  const outlines = new THREE.InstancedMesh(
    outlinePlane,
    new THREE.MeshBasicMaterial({ map: outlineTexture(), transparent: true, depthWrite: false }),
    n,
  )
  outlines.frustumCulled = false

  // Khu chưa mua (bên trong rào): viền ô thật mờ, để thấy trước chỗ mở rộng được.
  const lockedOutlines = new THREE.InstancedMesh(
    outlinePlane,
    new THREE.MeshBasicMaterial({ map: outlineTexture(), transparent: true, opacity: 0.35, depthWrite: false }),
    n,
  )
  lockedOutlines.frustumCulled = false
  let lockedLevel = -1

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
  // Biển 🔒 và giá ở giữa khu ruộng kế tiếp chưa mua.
  const lockSign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
  lockSign.scale.set(2.4, 1.2, 1)
  let lockKey = ''
  const scarecrow = createScarecrow()
  const scarecrowMesh = staticModel(scarecrow)
  scarecrowMesh.position.copy(scarecrow.position)
  scarecrowMesh.rotation.copy(scarecrow.rotation)
  scene.add(soil, outlines, lockedOutlines, drops, highlight, scarecrowMesh, lockSign)

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
      let nSoil = 0
      let nOutline = 0

      state.plots.forEach((plot, i) => {
        const c = plotCenter(plot.x, plot.z)
        if (plot.tilled) {
          soil.setMatrixAt(nSoil, m.makeTranslation(c.x, 0.05, c.z))
          soil.setColorAt(nSoil++, plot.crop && plot.wateredAt !== null ? WET : DRY)
        } else {
          outlines.setMatrixAt(nOutline++, m.makeTranslation(c.x, 0.016, c.z))
        }

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
      soil.count = nSoil
      outlines.count = nOutline
      outlines.instanceMatrix.needsUpdate = true
      soil.instanceMatrix.needsUpdate = true
      if (soil.instanceColor) soil.instanceColor.needsUpdate = true

      if (lockedLevel !== state.landLevel) {
        lockedLevel = state.landLevel
        let k = 0
        for (let b = state.landLevel + 1; b < LAND_BLOCKS.length; b++) {
          for (const cell of blockCells(b)) {
            const c = plotCenter(cell.x, cell.z)
            lockedOutlines.setMatrixAt(k++, m.makeTranslation(c.x, 0.015, c.z))
          }
        }
        lockedOutlines.count = k
        lockedOutlines.instanceMatrix.needsUpdate = true
      }

      const price = nextLandPrice(state)
      const key = `${state.landLevel}|${price}`
      if (key !== lockKey) {
        lockKey = key
        lockSign.visible = price !== null
        if (price !== null) {
          const c = blockCenter(state.landLevel + 1)
          lockSign.position.set(c.x, 0.9, c.z)
          ;(lockSign.material as THREE.SpriteMaterial).map = lockTexture(price)
          ;(lockSign.material as THREE.SpriteMaterial).needsUpdate = true
        }
      }
      lockSign.position.y = 0.9 + Math.sin(time * 2) * 0.06

      highlight.visible = focus !== null
      if (focus) {
        const c = plotCenter(focus.x, focus.z)
        highlight.position.set(c.x, 0.12, c.z)
        ;(highlight.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(time * 5) * 0.25
      }
    },
  }
}

/** Đất cuốc: nền nâu, bốn luống đất có rãnh tối và gờ sáng, lốm đốm sỏi. */
function soilTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#a86f3e'
  g.fillRect(0, 0, 64, 64)
  for (let row = 0; row < 4; row++) {
    const y = row * 16
    g.fillStyle = '#c4884f'
    g.fillRect(0, y + 2, 64, 5)
    g.fillStyle = '#7b4a26'
    g.fillRect(0, y + 10, 64, 4)
  }
  const rand = mulberry32(3)
  for (let i = 0; i < 60; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(60,35,15,0.35)' : 'rgba(230,190,140,0.35)'
    g.fillRect(Math.floor(rand() * 64), Math.floor(rand() * 64), 2, 2)
  }
  // Viền tối quanh ô cho khối đất rõ cạnh.
  g.strokeStyle = 'rgba(70,40,15,0.55)'
  g.lineWidth = 3
  g.strokeRect(1.5, 1.5, 61, 61)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  return tex
}

/** Viền ô chưa cuốc: khung bo góc mờ màu cỏ sẫm, giữa trong suốt. */
function outlineTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgba(70,110,35,0.55)'
  g.lineWidth = 4
  g.setLineDash([9, 5])
  g.beginPath()
  g.roundRect(4, 4, 56, 56, 9)
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.08)'
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Bù nhìn dựng từ khối cơ bản: cọc, tay ngang, áo, đầu bao tải và mũ rơm. */
function createScarecrow(): THREE.Group {
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 })
  const wood = mat(0x8a5a2b)
  const g = new THREE.Group()
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.9, 6), wood)
  post.position.y = 0.95
  const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6), wood)
  arms.rotation.z = Math.PI / 2
  arms.position.y = 1.35
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.32), mat(0x5b8fd6))
  shirt.position.y = 1.2
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.02), mat(0xe05a47))
  patch.position.set(0.12, 1.12, 0.17)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), mat(0xe8cf98))
  head.position.y = 1.72
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 0.04, 14), mat(0xf2c75c))
  brim.position.y = 1.9
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 12), mat(0xf2c75c))
  crown.position.y = 2.01
  // Rơm thò ra ở hai đầu tay.
  const strawGeo = new THREE.ConeGeometry(0.08, 0.2, 5)
  for (const side of [-1, 1]) {
    const straw = new THREE.Mesh(strawGeo, mat(0xf2d27a))
    straw.rotation.z = (side * Math.PI) / 2
    straw.position.set(side * 0.82, 1.35, 0)
    g.add(straw)
  }
  g.add(post, arms, shirt, patch, head, brim, crown)
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  g.position.set(SCARECROW.x, 0, SCARECROW.z)
  g.rotation.y = -0.5
  return g
}

/** Biển gỗ "🔒 500g" trên khu ruộng chưa mua. */
function lockTexture(price: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(176,110,51,0.95)'
  g.strokeStyle = '#4e2a0c'
  g.lineWidth = 8
  g.beginPath()
  g.roundRect(8, 16, 240, 96, 22)
  g.fill()
  g.stroke()
  g.fillStyle = '#fff9e6'
  g.font = 'bold 52px Fredoka, Nunito, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(`🔒 ${price}g`, 128, 66)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
