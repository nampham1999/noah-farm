import type { Season } from '../core/state.ts'
import balanceJson from './balance.json'
import cropsJson from './crops.json'
import itemsJson from './items.json'
import animalsJson from './animals.json'
import fishJson from './fish.json'
import furnitureJson from './furniture.json'
import machinesJson from './machines.json'

export interface CropDef {
  id: string
  seasons: Season[]
  seedPrice: number
  sellPrice: number
  growMinutes: number
  level: number
  xp: number
  energy: number
  color: string
  icon: string
  /** Tên mô hình trong crops.glb (Crop_<model>_2, Crop_<model>_3). */
  model: string
}

export type ItemKind = 'tool' | 'seed' | 'crop' | 'feed' | 'product' | 'fish' | 'furniture' | 'jar' | 'food'

export interface ItemDef {
  id: string
  kind: ItemKind
  icon: string
  /** Với hạt giống và nông sản: id cây trồng tương ứng. */
  cropId?: string
  buyPrice?: number
  sellPrice?: number
  /** Thể lực hồi khi ăn. */
  energy?: number
}

export const balance = balanceJson

export type AnimalType = 'chicken' | 'pig' | 'cow'

export interface AnimalDef {
  id: AnimalType
  price: number
  level: number
  product: string
  cycleDays: number
  xp: number
  icon: string
  /** Tỉ lệ phóng mô hình cho hợp với nhân vật. */
  scale: number
}

export const animalData = animalsJson as Omit<typeof animalsJson, 'animals'> & { animals: AnimalDef[] }
export const ANIMAL_BY_ID = new Map(animalData.animals.map((a) => [a.id, a]))

export interface FishDef {
  id: string
  /** Mùa có cá; rỗng là mùa nào cũng có. */
  seasons: Season[]
  /** Khung giờ [bắt đầu, kết thúc) có cá; null là cả ngày. Có thể vắt qua nửa đêm. */
  hours: [number, number] | null
  level: number
  price: number
  xp: number
  /** Tỉ lệ cắn câu so với các loài khác đang có. */
  weight: number
  /** Độ cao vùng xanh trong mini-game (0..1); nhỏ là khó. */
  zone: number
  /** Tốc độ cá chạy trong mini-game. */
  speed: number
  icon: string
}

export const FISH = fishJson as FishDef[]

export interface FurnitureDef {
  id: string
  price: number
  level: number
  /** Số ô chiếm theo chiều x (rộng) và z (sâu) khi chưa xoay. */
  w: number
  d: number
  icon: string
  /** bed: ngủ được; rug: thảm, đi lên được và đặt đồ khác lên trên. */
  kind?: 'bed' | 'rug'
}

export const FURNITURE = furnitureJson as FurnitureDef[]
export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]))

/** Độ dài một ngày trong game, tính bằng mili giây thật. */
export const DAY_MS = balance.dayRealMinutes * 60_000
export const CROPS = cropsJson as CropDef[]
export const CROP_BY_ID = new Map(CROPS.map((c) => [c.id, c]))

/** Hạt giống (seed_x) và nông sản (crop_x) sinh từ crops.json, không khai báo lặp. */
export const ITEMS = new Map<string, ItemDef>()
for (const def of itemsJson as ItemDef[]) ITEMS.set(def.id, def)
for (const c of CROPS) {
  ITEMS.set(`seed_${c.id}`, { id: `seed_${c.id}`, kind: 'seed', icon: c.icon, cropId: c.id, buyPrice: c.seedPrice })
  ITEMS.set(`crop_${c.id}`, { id: `crop_${c.id}`, kind: 'crop', icon: c.icon, cropId: c.id, sellPrice: c.sellPrice, energy: c.energy })
}

// Nội thất mua về (furn_x) nằm trong túi đồ cho tới khi đặt trong nhà.
for (const f of FURNITURE) {
  ITEMS.set(`furn_${f.id}`, { id: `furn_${f.id}`, kind: 'furniture', icon: f.icon, buyPrice: f.price })
}

// Cá câu được (fish_x) sinh từ fish.json.
for (const f of FISH) {
  ITEMS.set(`fish_${f.id}`, { id: `fish_${f.id}`, kind: 'fish', icon: f.icon, sellPrice: f.price })
}

export type MachineId = 'preserves' | 'stove' | 'beehive'

export interface MachineDef {
  id: MachineId
  price: number
  level: number
  icon: string
  /** Chỗ đặt máy ngoài trời. */
  x: number
  z: number
  /** Thời gian làm một mẻ (phút thật); tổ ong: một lần cho mật. */
  minutes: number
}

/** Nguyên liệu: một vật phẩm cụ thể (id), hoặc bất kỳ vật phẩm nào thuộc loại (kind). */
export interface RecipeInput {
  id?: string
  kind?: ItemKind
  qty: number
}

export interface RecipeDef {
  id: string
  icon: string
  inputs: RecipeInput[]
  sellPrice: number
  energy: number
}

export const MACHINES = machinesJson.machines as MachineDef[]
export const MACHINE_BY_ID = new Map(MACHINES.map((m) => [m.id, m]))
export const RECIPES = machinesJson.recipes as RecipeDef[]
export const JAR_FRUITS = new Set(machinesJson.jarFruits)
export const HONEY = machinesJson.honey

// Hũ ủ (jar_x): mỗi nông sản ủ thành mứt (trái cây) hoặc đồ muối, giá gấp đôi.
for (const c of CROPS) {
  ITEMS.set(`jar_${c.id}`, { id: `jar_${c.id}`, kind: 'jar', icon: '🫙', cropId: c.id, sellPrice: c.sellPrice * 2 + 25, energy: c.energy * 2 })
}
// Món nấu ở bếp (food_x) và mật ong.
for (const r of RECIPES) {
  ITEMS.set(`food_${r.id}`, { id: `food_${r.id}`, kind: 'food', icon: r.icon, sellPrice: r.sellPrice, energy: r.energy })
}
ITEMS.set(HONEY.id, { id: HONEY.id, kind: 'product', icon: HONEY.icon, sellPrice: HONEY.sellPrice, energy: HONEY.energy })

export function item(id: string): ItemDef {
  const def = ITEMS.get(id)
  if (!def) throw new Error(`Unknown item: ${id}`)
  return def
}

/** XP cần để đi từ cấp `level` lên cấp kế (GDD mục 7.4: XP_n = 100·n^1.5). */
export function xpToNext(level: number): number {
  return Math.round(balance.xpBase * (level + 1) ** balance.xpExponent)
}
