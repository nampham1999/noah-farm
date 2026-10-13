import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Mô hình 3D dùng lại từ bản cũ (cozyfarmy.com): phần lớn tự dựng bằng Blender,
 * nhân vật là KayKit Adventurers (CC0). File nằm ở public/assets.
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
  bush: 'models/bush.glb',
  bushFlower: 'models/bush-flower.glb',
  fence: 'models/fence-1.glb',
  grass: 'models/grass.glb',
  crops: 'models/crops.glb',
  debris: 'models/debris.glb',
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
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      onProgress(++done / names.length)
      return [name, gltf] as const
    }),
  )
  return Object.fromEntries(entries) as Models
}
