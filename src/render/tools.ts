import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Dụng cụ cầm tay lấy từ tools.glb của bản cũ: gốc toạ độ ở chỗ tay cầm, cán chạy theo +Z.
 * Cần câu và bình tưới có điểm "Tip_*" ở đầu (để nối dây câu, tia nước).
 */
export type ToolName = 'hoe' | 'watering_can' | 'fishing_rod' | 'seed' | 'sickle'

/** Mô hình gốc hơi nhỏ so với nhân vật của game này. */
const TOOL_SCALE = 1.25

let source: GLTF | null = null

export function initTools(gltf: GLTF): void {
  source = gltf
}

/** Bản sao dụng cụ để gắn vào tay; null nếu chưa tải được tools.glb. */
export function makeTool(name: ToolName): THREE.Object3D | null {
  const node = source?.scene.getObjectByName(`Tool_${name}`)
  if (!node) return null
  const tool = node.clone()
  tool.position.set(0, 0, 0)
  tool.scale.setScalar(TOOL_SCALE)
  tool.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  return tool
}

/** Điểm đầu dụng cụ (đầu cần câu, vòi bình tưới), nếu có. */
export function toolTip(tool: THREE.Object3D): THREE.Object3D | undefined {
  return tool.getObjectByName('Tip_fishing_rod') ?? tool.getObjectByName('Tip_watering_can')
}

/** Việc người chơi làm, để chọn hoạt ảnh và dụng cụ cầm tay. */
export type ActionName = 'hoe' | 'water' | 'plant' | 'harvest' | 'cast' | 'cheer' | 'pet'

export const ACTION_TOOL: Partial<Record<ActionName, ToolName>> = {
  hoe: 'hoe',
  water: 'watering_can',
  plant: 'seed',
  harvest: 'sickle',
  cast: 'fishing_rod',
}

/** Thời lượng mỗi hoạt ảnh (giây). */
export const ACTION_SECONDS: Record<ActionName, number> = {
  hoe: 0.65,
  water: 0.9,
  plant: 0.6,
  harvest: 0.6,
  cast: 0.7,
  cheer: 1.1,
  pet: 0.8,
}
