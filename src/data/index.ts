import type { Season } from '../core/state.ts'
import balanceJson from './balance.json'
import cropsJson from './crops.json'
import itemsJson from './items.json'
import animalsJson from './animals.json'

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

export type ItemKind = 'tool' | 'seed' | 'crop' | 'feed' | 'product'

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

export function item(id: string): ItemDef {
  const def = ITEMS.get(id)
  if (!def) throw new Error(`Unknown item: ${id}`)
  return def
}

/** XP cần để đi từ cấp `level` lên cấp kế (GDD mục 7.4: XP_n = 100·n^1.5). */
export function xpToNext(level: number): number {
  return Math.round(balance.xpBase * (level + 1) ** balance.xpExponent)
}
