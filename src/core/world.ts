/**
 * Bố cục tĩnh của nông trại, dùng chung cho hiển thị và va chạm.
 * Đơn vị: mét. Trục Y hướng lên, nông trại nằm giữa gốc toạ độ.
 */

import { mulberry32 } from './random.ts'

/** Nửa cạnh khu nông trại có hàng rào. */
export const FARM_HALF = 20
/** Nửa cạnh mặt đất hiển thị (gồm cả rừng bên ngoài hàng rào). */
export const GROUND_HALF = 60

export interface Circle {
  x: number
  z: number
  r: number
}

/** Nhà (mô hình house-1, khoảng 4,4 x 3,9 m), cửa quay về phía +Z. */
export const HOUSE = { x: -11, z: -11, r: 2.7 }
/** Hồ cá: tâm và bán kính trung bình; viền thật uốn lượn theo pondRadius(). */
export const POND = { x: 12, z: 11, r: 5 }

/** Bán kính viền hồ theo góc (radian, tính bằng atan2(z, x) quanh tâm hồ). */
export function pondRadius(angle: number): number {
  return POND.r + 0.7 * Math.sin(2 * angle + 1) + 0.45 * Math.sin(3 * angle + 2.2) + 0.25 * Math.sin(5 * angle + 0.5)
}

/** Bán kính lớn nhất của viền hồ, dùng để chừa chỗ khi rải cây, đồ trang trí. */
export const POND_MAX_R = POND.r + 1.4

/** Cầu gỗ chìa ra hồ từ bờ phía tây; đi lên được để sau này câu cá. */
export const DOCK = { x0: 6.3, x1: 9.9, z: 11, halfWidth: 0.65 }
/** Chòi câu cá trên bờ, cạnh chân cầu. */
export const FISHING_HUT = { x: 4.6, z: 8.4, r: 1.5 }

/** Điểm (x, z) có nằm dưới nước không (cầu gỗ không tính là nước). */
export function isWater(x: number, z: number, margin = 0): boolean {
  if (x >= DOCK.x0 && x <= DOCK.x1 && Math.abs(z - DOCK.z) <= DOCK.halfWidth) return false
  const dx = x - POND.x
  const dz = z - POND.z
  return Math.hypot(dx, dz) < pondRadius(Math.atan2(dz, dx)) + margin
}

/** Khu ô đất 4x4 (16 ô, GDD mục 7.3). */
export const PLOT_AREA = { x: 0, z: -3, cols: 4, rows: 4, size: 1.4 }
/** Bù nhìn ở góc khu ruộng. */
export const SCARECROW = { x: 3.7, z: -6.5, r: 0.35 }
/** Quầy hàng (mô hình shop, rộng khoảng 5,4 m), mặt quầy quay về phía +Z. r là vùng chạm để mở. */
export const STALL = { x: -7, z: 3, r: 2.2 }
/** Nửa chiều rộng quầy, để chặn hai đầu quầy khi đi. */
const STALL_HALF_WIDTH = 2.4

/** Đường đất: các đoạn thẳng nối cổng, chỗ xuất hiện, quầy hàng và nhà. */
export const PATHS: { from: [number, number]; to: [number, number]; width: number }[] = [
  { from: [0, FARM_HALF], to: [0, 5], width: 2.2 },
  { from: [0, 5], to: [STALL.x, 5], width: 2 },
  { from: [STALL.x, 5], to: [-11, 5], width: 2 },
  { from: [-11, 5], to: [-11, -8], width: 2 },
]
/** Chỗ hở trên hàng rào phía nam, nơi đường đất đi ra. */
export const GATE = { x: 0, halfWidth: 1.4 }

/** Toạ độ thế giới của tâm ô đất ở cột x, hàng z. */
export function plotCenter(x: number, z: number): { x: number; z: number } {
  const { size, cols, rows } = PLOT_AREA
  return {
    x: PLOT_AREA.x + (x - (cols - 1) / 2) * size,
    z: PLOT_AREA.z + (z - (rows - 1) / 2) * size,
  }
}

/** Ô đất (cột, hàng) chứa điểm thế giới; null nếu nằm ngoài khu ô đất. */
export function plotAt(wx: number, wz: number): { x: number; z: number } | null {
  const { size, cols, rows } = PLOT_AREA
  const x = Math.floor((wx - PLOT_AREA.x) / size + cols / 2)
  const z = Math.floor((wz - PLOT_AREA.z) / size + rows / 2)
  return x >= 0 && x < cols && z >= 0 && z < rows ? { x, z } : null
}

export interface Tree extends Circle {
  scale: number
  /** Chọn loại mô hình cây, 0..1. */
  variant: number
  rotY: number
}

export interface Decor {
  x: number
  z: number
  rotY: number
  scale: number
}

/** Đồ vật quanh nhà và quầy hàng (mô hình KayKit), có va chạm theo r. */
export interface Prop {
  model: 'well' | 'barrel' | 'crate' | 'sack' | 'wheelbarrow' | 'bucket' | 'pallet' | 'lumber'
  x: number
  z: number
  rotY: number
  r: number
}

export const PROPS: Prop[] = [
  { model: 'well', x: -6.2, z: -9.2, rotY: 0.3, r: 1.2 },
  { model: 'bucket', x: -4.9, z: -8.3, rotY: 0, r: 0 },
  { model: 'barrel', x: -10.2, z: 2.2, rotY: 0, r: 0.4 },
  { model: 'barrel', x: -10.3, z: 3.3, rotY: 1, r: 0.4 },
  { model: 'crate', x: -3.7, z: 2.3, rotY: 0.4, r: 0.45 },
  { model: 'sack', x: -3.8, z: 3.3, rotY: 1.2, r: 0 },
  { model: 'wheelbarrow', x: 4.3, z: -1.4, rotY: -0.6, r: 0.6 },
  { model: 'pallet', x: -8.6, z: -8.4, rotY: 0.2, r: 0 },
  { model: 'sack', x: -8.5, z: -8.5, rotY: 0.6, r: 0 },
  { model: 'lumber', x: -14.6, z: -8.8, rotY: 1.4, r: 1.1 },
]

/** Cây trang trí, sinh ngẫu nhiên có hạt giống cố định để lần nào cũng giống nhau. */
export const TREES: Tree[] = generateTrees()

const decorRand = mulberry32(7)
/** Bụi cây và đá trong nông trại (có va chạm). */
export const BUSHES: Decor[] = scatter(decorRand, 14, FARM_HALF - 1.5, 3)
export const ROCKS: Decor[] = scatter(decorRand, 8, FARM_HALF - 1.5, 3)
/** Bụi cỏ nhỏ và hoa dại để trang trí, đi xuyên qua được. */
export const TUFTS: Decor[] = scatter(decorRand, 500, FARM_HALF - 0.5, 0.6)
export const FLOWERS: Decor[] = scatter(decorRand, 220, FARM_HALF - 0.8, 0.8)


/** Vật cản hình tròn cho va chạm của nhân vật. */
export const OBSTACLES: Circle[] = [
  HOUSE,
  FISHING_HUT,
  SCARECROW,
  ...PROPS.filter((p) => p.r > 0),
  ...[-1, 0, 1].map((k) => ({ x: STALL.x + k * (STALL_HALF_WIDTH - 1.1), z: STALL.z, r: 1.2 })),
  ...BUSHES.map((b) => ({ x: b.x, z: b.z, r: 0.5 * b.scale })),
  ...ROCKS.map((b) => ({ x: b.x, z: b.z, r: 0.45 * b.scale })),
  ...TREES.filter((tr) => Math.abs(tr.x) < FARM_HALF && Math.abs(tr.z) < FARM_HALF).map((tr) => ({
    x: tr.x,
    z: tr.z,
    r: 0.5 * tr.scale,
  })),
]

function generateTrees(): Tree[] {
  const rand = mulberry32(20261013)
  const trees: Tree[] = []
  // Rừng bên ngoài hàng rào.
  while (trees.length < 160) {
    const x = (rand() * 2 - 1) * (GROUND_HALF - 4)
    const z = (rand() * 2 - 1) * (GROUND_HALF - 4)
    if (Math.abs(x) < FARM_HALF + 2 && Math.abs(z) < FARM_HALF + 2) continue
    trees.push({ x, z, r: 0, scale: 0.8 + rand() * 0.8, variant: rand(), rotY: rand() * Math.PI * 2 })
  }
  // Vài cây trong nông trại, tránh nhà, hồ, khu ô đất và chỗ nhân vật xuất hiện.
  let placed = 0
  while (placed < 10) {
    const x = (rand() * 2 - 1) * (FARM_HALF - 2)
    const z = (rand() * 2 - 1) * (FARM_HALF - 2)
    if (isReserved(x, z, 3)) continue
    trees.push({ x, z, r: 0, scale: 0.9 + rand() * 0.4, variant: rand(), rotY: rand() * Math.PI * 2 })
    placed++
  }
  return trees
}

/** Chỗ đã dùng (nhà, hồ, ô đất, quầy, đường đất): không đặt cây hay đồ trang trí lên. */
function isReserved(x: number, z: number, margin: number): boolean {
  const areas: Circle[] = [
    { x: HOUSE.x, z: HOUSE.z, r: HOUSE.r + 1 },
    { x: POND.x, z: POND.z, r: POND_MAX_R + 0.6 },
    { x: FISHING_HUT.x, z: FISHING_HUT.z, r: FISHING_HUT.r + 0.5 },
    { x: SCARECROW.x, z: SCARECROW.z, r: 1 },
    ...PROPS.map((p) => ({ x: p.x, z: p.z, r: Math.max(0.6, p.r + 0.3) })),
    { x: STALL.x, z: STALL.z, r: STALL_HALF_WIDTH + 0.5 },
    { x: 0, z: 6, r: 1.5 },
  ]
  if (areas.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + margin * 0.5)) return true
  const half = (PLOT_AREA.cols * PLOT_AREA.size) / 2 + 0.6
  if (Math.abs(x - PLOT_AREA.x) < half + margin * 0.5 && Math.abs(z - PLOT_AREA.z) < half + margin * 0.5) return true
  return PATHS.some((p) => distToSegment(x, z, p.from, p.to) < p.width / 2 + margin * 0.3)
}

function scatter(rand: () => number, count: number, half: number, margin: number): Decor[] {
  const out: Decor[] = []
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = (rand() * 2 - 1) * half
    const z = (rand() * 2 - 1) * half
    if (isReserved(x, z, margin)) continue
    out.push({ x, z, rotY: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.5 })
  }
  return out
}

function distToSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}
