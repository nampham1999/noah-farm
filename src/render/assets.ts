import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Mô hình 3D dùng lại từ bản cũ (cozyfarmy.com): phần lớn tự dựng bằng Blender,
 * nhân vật là KayKit Adventurers, đồ vật nhỏ là KayKit Medieval Hexagon. File nằm ở public/assets.
 */
export const MODELS = {
  farmer: 'characters/Rogue.glb',
  house: 'models/house-1.glb',
  shop: 'models/shop.glb',
  treeGreen: 'models/tree-green.glb',
  treeSpring: 'models/tree-spring.glb',
  treeBlossom: 'models/tree-blossom.glb',
  treePine: 'models/tree-pine.glb',
  treeGreenLo: 'models/tree-green-lo.glb',
  treeSpringLo: 'models/tree-spring-lo.glb',
  treeApple: 'models/tree-apple.glb',
  treeCitrus: 'models/tree-citrus.glb',
  treeAutumn: 'models/tree-autumn.glb',
  treeBirchAutumn: 'models/tree-birch-autumn.glb',
  treeWinter: 'models/tree-winter.glb',
  treeSnowy: 'models/tree-snowy.glb',
  treeBirchWinter: 'models/tree-birch-winter.glb',
  treeAutumnLo: 'models/tree-autumn-lo.glb',
  treeSnowyLo: 'models/tree-snowy-lo.glb',
  treePineSnow: 'models/tree-pine-snow.glb',
  bush: 'models/bush.glb',
  bushFlower: 'models/bush-flower.glb',
  bushSnow: 'models/bush-snow.glb',
  fence: 'models/fence-1.glb',
  grass: 'models/grass.glb',
  crops: 'models/crops.glb',
  debris: 'models/debris.glb',
  fishingHut: 'models/fishing-hut.glb',
  coop: 'models/coop.glb',
  furniture: 'models/furniture.glb',
  cowbarn: 'models/cowbarn.glb',
  chicken: 'models/chicken.glb',
  pig: 'models/pig.glb',
  cow: 'models/cow.glb',
  boat: 'models/boat.glb',
  lilyA: 'kaykit-hex/waterlily_A.gltf',
  lilyB: 'kaykit-hex/waterlily_B.gltf',
  reedA: 'kaykit-hex/waterplant_A.gltf',
  reedB: 'kaykit-hex/waterplant_B.gltf',
  rockA: 'kaykit-hex/rock_single_A.gltf',
  rockC: 'kaykit-hex/rock_single_C.gltf',
  well: 'kaykit-hex/building_well_blue.gltf',
  barrel: 'kaykit-hex/barrel.gltf',
  crate: 'kaykit-hex/crate_A_big.gltf',
  sack: 'kaykit-hex/sack.gltf',
  wheelbarrow: 'kaykit-hex/wheelbarrow.gltf',
  bucket: 'kaykit-hex/bucket_water.gltf',
  pallet: 'kaykit-hex/pallet.gltf',
  lumber: 'kaykit-hex/resource_lumber.gltf',
} as const

export type ModelName = keyof typeof MODELS
export type Models = Record<ModelName, GLTF>

const BASE = `${import.meta.env.BASE_URL}assets/`

/** Tải mọi mô hình song song; onProgress nhận tỉ lệ 0..1 để vẽ thanh tải. */
export async function loadModels(onProgress: (fraction: number) => void): Promise<Models> {
  const loader = new GLTFLoader()
  const names = Object.keys(MODELS) as ModelName[]
  let done = 0
  const entries = await Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(BASE + MODELS[name])
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.castShadow = true
        o.receiveShadow = true
        // Như bản cũ: texture KayKit lọc điểm ảnh cho sắc nét, bỏ ánh kim loại cho hợp phong cách.
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue
          if (m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace
            m.map.magFilter = THREE.NearestFilter
          }
          m.metalness = 0
          m.roughness = Math.max(m.roughness, 0.75)
        }
      })
      onProgress(++done / names.length)
      return [name, gltf] as const
    }),
  )
  return Object.fromEntries(entries) as Models
}
