/**
 * Bố cục tĩnh của nông trại, dùng chung cho hiển thị và va chạm.
 * Đơn vị: mét. Trục Y hướng lên, nông trại nằm giữa gốc toạ độ.
 */

import { MACHINES } from '../data/index.ts'
import { mulberry32 } from './random.ts'

/** Nửa cạnh khu nông trại có hàng rào (nông trại 36 x 36 m, gọn để các khu gần nhau). */
export const FARM_HALF = 18

/*
 * Bố cục (bắc ở trên, camera nhìn từ phía nam):
 *   - Đường chính chạy dọc x = MAIN_ROAD_X từ cổng nam lên tới trước nhà.
 *   - Nhà ở phía tây bắc, chuồng ở đông bắc.
 *   - Khu ruộng có rào ở phía tây đường chính, cổng mở ra đường ở cạnh đông.
 *   - Hồ cá ở phía đông; quầy hàng, bảng đơn hàng và dân làng gần lối vào.
 */
export const MAIN_ROAD_X = 5
/** Nửa cạnh mặt đất hiển thị (gồm cả rừng bên ngoài hàng rào). */
export const GROUND_HALF = 50

export interface Circle {
  x: number
  z: number
  r: number
}

/** Nhà (mô hình house-1, khoảng 4,4 x 3,9 m), cửa quay về phía +Z. */
export const HOUSE = { x: -6, z: -12, r: 2.7 }
/** Chỗ đứng trước cửa nhà để vào nhà, và chỗ ra lại sau khi ra khỏi nhà. */
export const HOUSE_DOOR = { x: -6, z: -8.9 }

/**
 * Trong nhà: một phòng W x D ô (1 ô = 1 m), dựng ở xa nông trại để khỏi thấy nhau.
 * Ô (cx, cz) tính từ góc tây bắc; cửa ra ở giữa cạnh nam (phía camera).
 */
export const ROOM = { x: 0, z: -200, w: 12, d: 9 }

/** Toạ độ thế giới của góc tây bắc phòng. */
export function roomCorner(): { x: number; z: number } {
  return { x: ROOM.x - ROOM.w / 2, z: ROOM.z - ROOM.d / 2 }
}

/** Ô trong phòng chứa điểm thế giới; null nếu ngoài phòng. */
export function roomCellAt(wx: number, wz: number): { cx: number; cz: number } | null {
  const c = roomCorner()
  const cx = Math.floor(wx - c.x)
  const cz = Math.floor(wz - c.z)
  return cx >= 0 && cx < ROOM.w && cz >= 0 && cz < ROOM.d ? { cx, cz } : null
}

/** Chỗ xuất hiện khi vào nhà (ngay trong cửa). */
export const ROOM_ENTRY = { x: ROOM.x, z: ROOM.z + ROOM.d / 2 - 0.7 }

/** Kích thước phòng (ô) theo cấp nhà 1..5; chiều rộng chẵn để cửa nằm giữa. */
export const ROOM_SIZES = [
  { w: 12, d: 9 },
  { w: 14, d: 10 },
  { w: 16, d: 11 },
  { w: 18, d: 12 },
  { w: 20, d: 13 },
]

/** Đổi kích thước phòng theo cấp nhà (đồ đã đặt tính từ góc tây bắc nên vẫn giữ chỗ). */
export function setRoomSize(level: number): void {
  const size = ROOM_SIZES[Math.max(0, Math.min(ROOM_SIZES.length - 1, level - 1))]
  ROOM.w = size.w
  ROOM.d = size.d
  ROOM_ENTRY.z = ROOM.z + ROOM.d / 2 - 0.7
}
/** Hồ cá: tâm và bán kính trung bình; viền thật uốn lượn theo pondRadius(). */
export const POND = { x: 11.5, z: 4.5, r: 4.2 }

/** Bán kính viền hồ theo góc (radian, tính bằng atan2(z, x) quanh tâm hồ). */
export function pondRadius(angle: number): number {
  return POND.r + 0.7 * Math.sin(2 * angle + 1) + 0.45 * Math.sin(3 * angle + 2.2) + 0.25 * Math.sin(5 * angle + 0.5)
}

/** Bán kính lớn nhất của viền hồ, dùng để chừa chỗ khi rải cây, đồ trang trí. */
export const POND_MAX_R = POND.r + 1.4

/** Cầu gỗ chìa ra hồ từ bờ phía tây; đi lên được để sau này câu cá. */
export const DOCK = { x0: 6.4, x1: 9.6, z: 4.5, halfWidth: 0.65 }
/** Chòi câu cá trên bờ, cạnh chân cầu. */
export const FISHING_HUT = { x: 8.6, z: -2, r: 1.5 }

/** Điểm (x, z) có nằm dưới nước không (cầu gỗ không tính là nước). */
export function isWater(x: number, z: number, margin = 0): boolean {
  if (x >= DOCK.x0 && x <= DOCK.x1 && Math.abs(z - DOCK.z) <= DOCK.halfWidth) return false
  const dx = x - POND.x
  const dz = z - POND.z
  return Math.hypot(dx, dz) < pondRadius(Math.atan2(dz, dx)) + margin
}

/** Một khu ruộng là 4x4 ô (16 ô, GDD mục 7.3); khu đầu tiên có sẵn, các khu sau mua thêm. */
export const PLOT_AREA = { x: -7, z: -1, cols: 4, rows: 4, size: 1.4 }
/**
 * Khoảng cách giữa tâm hai khu ruộng liền nhau. bz âm là phía nam (z dương), để các khu
 * mua thêm xếp thành hai hàng gọn trong rào mà bản lưu cũ (đánh số theo bx, bz) vẫn khớp.
 */
const BLOCK_STEP = { x: 6.2, z: -6.4 }
/** Vị trí các khu theo thứ tự mở: giữa, đông, tây, rồi hai khu hàng dưới (đơn vị: khu). */
export const LAND_BLOCKS: { bx: number; bz: number }[] = [
  { bx: 0, bz: 0 },
  { bx: 1, bz: 0 },
  { bx: -1, bz: 0 },
  { bx: 0, bz: -1 },
  { bx: 1, bz: -1 },
]

/** Tâm của khu ruộng thứ i. */
export function blockCenter(i: number): { x: number; z: number } {
  const b = LAND_BLOCKS[i]
  return { x: PLOT_AREA.x + b.bx * BLOCK_STEP.x, z: PLOT_AREA.z + b.bz * BLOCK_STEP.z }
}

/** Các ô (cột, hàng toàn cục) của khu ruộng thứ i. */
export function blockCells(i: number): { x: number; z: number }[] {
  const b = LAND_BLOCKS[i]
  const cells: { x: number; z: number }[] = []
  for (let c = 0; c < PLOT_AREA.cols; c++) {
    for (let r = 0; r < PLOT_AREA.rows; r++) cells.push({ x: b.bx * PLOT_AREA.cols + c, z: b.bz * PLOT_AREA.rows + r })
  }
  return cells
}
/** Chuồng (dựng khi mua) và bãi thả quanh chuồng nơi vật nuôi đi lại. */
export const COOP = { x: 11.5, z: -14, r: 2.3 }
export const PEN = { x: 11, z: -7.2, r: 3 }

/** Bảng đơn hàng của dân làng, cạnh lối vào; dân làng có đơn đi loanh quanh khu VILLAGE. */
export const ORDER_BOARD = { x: 7.6, z: 13.4, r: 0.6 }
export const VILLAGE = { x: 10.8, z: 14.6, r: 2.2 }
/** Chỗ Ông Tom đứng câu cá: đầu cầu gỗ, quay ra hồ. */
export const TOM_SPOT = { x: 9.1, z: 4.1, rotY: Math.PI / 2 }

/** Khu ruộng có rào: hình chữ nhật bao mọi khu (kể cả khu chưa mua), cổng ở cạnh đông. */
export const FIELD = { x0: -16.7, x1: 2.7, z0: -4.5, z1: 8.9 }
export const FIELD_GATE = { z: 2.2, half: 1.1 }
/** Điểm đứng ngay ngoài và ngay trong cổng ruộng, để tự đi vòng qua cổng. */
export const FIELD_GATE_OUT = { x: FIELD.x1 + 1.2, z: FIELD_GATE.z }
export const FIELD_GATE_IN = { x: FIELD.x1 - 1.2, z: FIELD_GATE.z }

export function insideField(x: number, z: number): boolean {
  return x > FIELD.x0 && x < FIELD.x1 && z > FIELD.z0 && z < FIELD.z1
}

/** Các đoạn rào ruộng (thẳng, dọc theo trục), chừa cổng; dùng cho hiển thị và va chạm. */
export const FIELD_FENCE: { from: [number, number]; to: [number, number] }[] = [
  { from: [FIELD.x0, FIELD.z0], to: [FIELD.x1, FIELD.z0] },
  { from: [FIELD.x0, FIELD.z1], to: [FIELD.x1, FIELD.z1] },
  { from: [FIELD.x0, FIELD.z0], to: [FIELD.x0, FIELD.z1] },
  { from: [FIELD.x1, FIELD.z0], to: [FIELD.x1, FIELD_GATE.z - FIELD_GATE.half] },
  { from: [FIELD.x1, FIELD_GATE.z + FIELD_GATE.half], to: [FIELD.x1, FIELD.z1] },
]

/** Bù nhìn ở góc trống của khu ruộng. */
export const SCARECROW = { x: -13.2, z: 5.4, r: 0.35 }
/** Quầy hàng (mô hình shop, rộng khoảng 5,4 m), mặt quầy quay về phía +Z. r là vùng chạm để mở. */
export const STALL = { x: -4, z: 13.5, r: 2.2 }
/** Nửa chiều rộng quầy, để chặn hai đầu quầy khi đi. */
const STALL_HALF_WIDTH = 2.4

/** Đường đất: các đoạn thẳng nối cổng, chỗ xuất hiện, quầy hàng và nhà. */
export const PATHS: { from: [number, number]; to: [number, number]; width: number }[] = [
  // Đường chính từ cổng nam lên tới ngang nhà.
  { from: [MAIN_ROAD_X, FARM_HALF], to: [MAIN_ROAD_X, -6.8], width: 2.4 },
  // Rẽ trái tới cửa nhà.
  { from: [MAIN_ROAD_X, -6.8], to: [HOUSE_DOOR.x, -6.8], width: 2 },
  { from: [HOUSE_DOOR.x, -6.8], to: [HOUSE_DOOR.x, HOUSE_DOOR.z], width: 2 },
  // Lối vào cổng ruộng.
  { from: [FIELD.x1, FIELD_GATE.z], to: [MAIN_ROAD_X, FIELD_GATE.z], width: 2 },
  // Sân trước quầy hàng.
  { from: [STALL.x - 2.5, 16.2], to: [MAIN_ROAD_X, 16.2], width: 2 },
  // Lối ra cầu câu cá.
  { from: [MAIN_ROAD_X, DOCK.z], to: [DOCK.x0, DOCK.z], width: 1.6 },
]
/** Chỗ hở trên hàng rào phía nam, nơi đường đất đi ra. */
export const GATE = { x: MAIN_ROAD_X, halfWidth: 1.6 }
/** Chỗ người chơi mới xuất hiện: trên đường chính, gần lối vào. */
export const SPAWN = { x: MAIN_ROAD_X, z: 15.8, rotY: Math.PI }

/** Toạ độ thế giới của tâm ô đất ở cột x, hàng z (toàn cục, khu nào cũng dùng chung lưới này). */
export function plotCenter(x: number, z: number): { x: number; z: number } {
  const { size, cols, rows } = PLOT_AREA
  const bx = Math.floor(x / cols)
  const bz = Math.floor(z / rows)
  return {
    x: PLOT_AREA.x + bx * BLOCK_STEP.x + (x - bx * cols - (cols - 1) / 2) * size,
    z: PLOT_AREA.z + bz * BLOCK_STEP.z + (z - bz * rows - (rows - 1) / 2) * size,
  }
}

/** Ô đất (cột, hàng) và khu chứa điểm thế giới; null nếu không nằm trong khu ruộng nào. */
export function plotAt(wx: number, wz: number): { x: number; z: number; block: number } | null {
  const { size, cols, rows } = PLOT_AREA
  for (let i = 0; i < LAND_BLOCKS.length; i++) {
    const c = blockCenter(i)
    const lx = Math.floor((wx - c.x) / size + cols / 2)
    const lz = Math.floor((wz - c.z) / size + rows / 2)
    if (lx >= 0 && lx < cols && lz >= 0 && lz < rows) {
      return { x: LAND_BLOCKS[i].bx * cols + lx, z: LAND_BLOCKS[i].bz * rows + lz, block: i }
    }
  }
  return null
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
  // Quanh nhà.
  { model: 'well', x: -0.6, z: -10.6, rotY: 0.3, r: 1.2 },
  { model: 'bucket', x: 0.7, z: -9.8, rotY: 0, r: 0 },
  { model: 'pallet', x: -10.3, z: -8.6, rotY: 0.2, r: 0 },
  { model: 'sack', x: -10.2, z: -8.7, rotY: 0.6, r: 0 },
  { model: 'lumber', x: -12.6, z: -11.4, rotY: 1.4, r: 1.1 },
  // Quanh quầy hàng.
  { model: 'barrel', x: -7.6, z: 12.9, rotY: 0, r: 0.4 },
  { model: 'barrel', x: -7.7, z: 14, rotY: 1, r: 0.4 },
  { model: 'crate', x: -0.4, z: 13, rotY: 0.4, r: 0.45 },
  { model: 'sack', x: -0.3, z: 14.1, rotY: 1.2, r: 0 },
  // Góc trống trong ruộng.
  { model: 'wheelbarrow', x: -11.4, z: 7.4, rotY: -0.6, r: 0.6 },
]

/** Cây trang trí, sinh ngẫu nhiên có hạt giống cố định để lần nào cũng giống nhau. */
export const TREES: Tree[] = generateTrees()

const decorRand = mulberry32(7)
/** Bụi cây và đá trong nông trại (có va chạm). */
export const BUSHES: Decor[] = scatter(decorRand, 9, FARM_HALF - 1.5, 3)
export const ROCKS: Decor[] = scatter(decorRand, 5, FARM_HALF - 1.5, 3)
/** Bụi cỏ nhỏ và hoa dại để trang trí, đi xuyên qua được. */
export const TUFTS: Decor[] = scatter(decorRand, 300, FARM_HALF - 0.5, 0.6)
export const FLOWERS: Decor[] = scatter(decorRand, 130, FARM_HALF - 0.8, 0.8)


/** Vật cản hình tròn cho va chạm của nhân vật. */
export const OBSTACLES: Circle[] = [
  HOUSE,
  // Chái phía tây của nhà cấp 4, 5.
  { x: HOUSE.x - 2.8, z: HOUSE.z - 0.2, r: 1.3 },
  FISHING_HUT,
  SCARECROW,
  COOP,
  ORDER_BOARD,
  // Máy chế biến (hoặc biển chờ mua) ở góc xưởng cạnh nhà.
  ...MACHINES.map((m) => ({ x: m.x, z: m.z, r: 0.55 })),
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
  while (placed < 6) {
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
    { x: COOP.x, z: COOP.z, r: COOP.r + 0.8 },
    { x: ORDER_BOARD.x, z: ORDER_BOARD.z, r: 1.2 },
    { x: VILLAGE.x, z: VILLAGE.z, r: VILLAGE.r },
    { x: PEN.x, z: PEN.z, r: PEN.r + 0.4 },
    ...PROPS.map((p) => ({ x: p.x, z: p.z, r: Math.max(0.6, p.r + 0.3) })),
    ...MACHINES.map((m) => ({ x: m.x, z: m.z, r: 1.4 })),
    { x: STALL.x, z: STALL.z, r: STALL_HALF_WIDTH + 0.5 },
    { x: SPAWN.x, z: SPAWN.z, r: 1.5 },
  ]
  if (areas.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + margin * 0.5)) return true
  // Chừa cả khu ruộng có rào (kể cả khu chưa mua) và một lối quanh rào.
  const m = 0.8 + margin * 0.5
  if (x > FIELD.x0 - m && x < FIELD.x1 + m && z > FIELD.z0 - m && z < FIELD.z1 + m) return true
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
