/**
 * Bản vẽ nhà do người chơi tự thiết kế (mỗi tầng một bản vẽ): tường và cửa đặt trên cạnh ô, mỗi ô có loại phòng,
 * sàn và màu tường. Phòng là các ô nối liền nhau không bị tường hay cửa ngăn, nên chia phòng bằng cách dựng tường.
 *
 * Khoá cạnh: 'h:cx,cz' là cạnh phía bắc của ô (cx, cz) (giữa hàng cz - 1 và hàng cz); 'v:cx,cz' là cạnh phía tây
 * (giữa cột cx - 1 và cột cx). Cạnh ngoài cùng của nhà luôn là tường ngoài, không lưu.
 */

export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bath', 'study', 'dining'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

export const FLOOR_IDS = ['plank', 'darkwood', 'tile_white', 'tile_green', 'tile_blue', 'carpet_red', 'carpet_blue', 'carpet_purple', 'stone', 'marble'] as const
export type FloorId = (typeof FLOOR_IDS)[number]

export const WALL_PAINTS = ['cream', 'blush', 'sky', 'sage', 'lavender', 'butter', 'white', 'charcoal'] as const
export type WallPaint = (typeof WALL_PAINTS)[number]

export interface CellStyle {
  t: RoomType
  f: FloorId
  w: WallPaint
}

export interface HousePlan {
  /** 1 = tường, 2 = cửa (lối đi). */
  walls: Record<string, 1 | 2>
  /** Chỉ lưu các ô khác mặc định. */
  cells: Record<string, CellStyle>
}

export const DEFAULT_STYLE: CellStyle = { t: 'living', f: 'plank', w: 'cream' }

/** Sàn và màu tường gợi ý khi gán một loại phòng (người chơi vẫn đổi được). */
export const ROOM_DEFAULTS: Record<RoomType, { f: FloorId; w: WallPaint }> = {
  living: { f: 'plank', w: 'cream' },
  bedroom: { f: 'carpet_blue', w: 'sky' },
  kitchen: { f: 'tile_green', w: 'butter' },
  bath: { f: 'tile_blue', w: 'white' },
  study: { f: 'darkwood', w: 'sage' },
  dining: { f: 'plank', w: 'blush' },
}

export const emptyPlan = (): HousePlan => ({ walls: {}, cells: {} })

export const cellKey = (cx: number, cz: number): string => `${cx},${cz}`
export const hKey = (cx: number, cz: number): string => `h:${cx},${cz}`
export const vKey = (cx: number, cz: number): string => `v:${cx},${cz}`

export function styleAt(plan: HousePlan, cx: number, cz: number): CellStyle {
  return plan.cells[cellKey(cx, cz)] ?? DEFAULT_STYLE
}

/** Cạnh hợp lệ trong nhà rộng w × d (không tính cạnh ngoài cùng). */
export function parseEdge(key: string, w: number, d: number): { axis: 'h' | 'v'; cx: number; cz: number } | null {
  const m = /^([hv]):(\d+),(\d+)$/.exec(key)
  if (!m) return null
  const axis = m[1] as 'h' | 'v'
  const cx = Number(m[2])
  const cz = Number(m[3])
  if (axis === 'h' ? cx < 0 || cx >= w || cz < 1 || cz >= d : cx < 1 || cx >= w || cz < 0 || cz >= d) return null
  return { axis, cx, cz }
}

/** Vật chắn trên cạnh giữa ô (cx, cz) và ô kế bên theo hướng dir: 0 thông, 1 tường, 2 cửa. Ngoài nhà là tường. */
export function edgeBetween(plan: HousePlan, w: number, d: number, cx: number, cz: number, dir: 'n' | 's' | 'w' | 'e'): 0 | 1 | 2 {
  if (dir === 'n') return cz <= 0 ? 1 : (plan.walls[hKey(cx, cz)] ?? 0)
  if (dir === 's') return cz >= d - 1 ? 1 : (plan.walls[hKey(cx, cz + 1)] ?? 0)
  if (dir === 'w') return cx <= 0 ? 1 : (plan.walls[vKey(cx, cz)] ?? 0)
  return cx >= w - 1 ? 1 : (plan.walls[vKey(cx + 1, cz)] ?? 0)
}

export interface Room {
  id: number
  cells: { cx: number; cz: number }[]
  /** Loại phòng: loại có nhiều ô nhất. */
  type: RoomType
}

/** Chia nhà thành các phòng: ô nối liền nhau qua cạnh không có tường và không có cửa. */
export function roomsOf(plan: HousePlan, w: number, d: number): Room[] {
  const seen = new Uint8Array(w * d)
  const rooms: Room[] = []
  for (let z0 = 0; z0 < d; z0++) {
    for (let x0 = 0; x0 < w; x0++) {
      if (seen[z0 * w + x0]) continue
      const cells: { cx: number; cz: number }[] = []
      const stack = [[x0, z0]]
      seen[z0 * w + x0] = 1
      while (stack.length) {
        const [x, z] = stack.pop()!
        cells.push({ cx: x, cz: z })
        for (const [dir, nx, nz] of [['n', x, z - 1], ['s', x, z + 1], ['w', x - 1, z], ['e', x + 1, z]] as const) {
          if (nx < 0 || nz < 0 || nx >= w || nz >= d || seen[nz * w + nx]) continue
          if (edgeBetween(plan, w, d, x, z, dir) !== 0) continue
          seen[nz * w + nx] = 1
          stack.push([nx, nz])
        }
      }
      const count = new Map<RoomType, number>()
      for (const c of cells) count.set(styleAt(plan, c.cx, c.cz).t, (count.get(styleAt(plan, c.cx, c.cz).t) ?? 0) + 1)
      const type = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
      rooms.push({ id: rooms.length, cells, type })
    }
  }
  return rooms
}

/** Các cạnh nối hai đỉnh lưới (vx, vz) → (ux, uz) nằm trên một đường thẳng (đổi sang trục chính nếu lệch). */
export function edgesBetween(a: { x: number; z: number }, b: { x: number; z: number }, w: number, d: number): string[] {
  const dx = Math.abs(b.x - a.x)
  const dz = Math.abs(b.z - a.z)
  const out: string[] = []
  if (dx >= dz) {
    const z = a.z
    for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x++) out.push(hKey(x, z))
  } else {
    const x = a.x
    for (let z = Math.min(a.z, b.z); z < Math.max(a.z, b.z); z++) out.push(vKey(x, z))
  }
  return out.filter((k) => parseEdge(k, w, d))
}

/** Các ô nối liền với ô (cx, cz) (cả phòng); rỗng nếu ô ngoài nhà. */
export function roomCellsAt(plan: HousePlan, w: number, d: number, cx: number, cz: number): { cx: number; cz: number }[] {
  return roomsOf(plan, w, d).find((r) => r.cells.some((c) => c.cx === cx && c.cz === cz))?.cells ?? []
}

/** Chuẩn hoá dữ liệu đọc từ bản lưu: bỏ khoá sai, giá trị lạ. */
export function normalizePlan(raw: unknown, w: number, d: number): HousePlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { walls?: Record<string, unknown>; cells?: Record<string, unknown> }
  const plan = emptyPlan()
  for (const [k, v] of Object.entries(o.walls ?? {})) {
    if (parseEdge(k, w, d) && (v === 1 || v === 2)) plan.walls[k] = v
  }
  for (const [k, v] of Object.entries(o.cells ?? {})) {
    const m = /^(\d+),(\d+)$/.exec(k)
    if (!m || Number(m[1]) >= w || Number(m[2]) >= d) continue
    const s = (v && typeof v === 'object' ? v : {}) as Partial<CellStyle>
    const t = ROOM_TYPES.includes(s.t as RoomType) ? (s.t as RoomType) : DEFAULT_STYLE.t
    const f = FLOOR_IDS.includes(s.f as FloorId) ? (s.f as FloorId) : DEFAULT_STYLE.f
    const wp = WALL_PAINTS.includes(s.w as WallPaint) ? (s.w as WallPaint) : DEFAULT_STYLE.w
    if (t !== DEFAULT_STYLE.t || f !== DEFAULT_STYLE.f || wp !== DEFAULT_STYLE.w) plan.cells[k] = { t, f, w: wp }
  }
  return plan
}

/** Bố cục mẫu theo cấp nhà (phòng khách, phòng ngủ, bếp, vệ sinh, làm việc): dùng làm gợi ý và để chuyển bản lưu cũ. */
export function presetPlan(level: number): HousePlan {
  const plan = emptyPlan()
  if (level < 2) return plan
  const paint = (x0: number, x1: number, z0: number, z1: number, t: RoomType) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) plan.cells[cellKey(x, z)] = { t, ...ROOM_DEFAULTS[t] }
  }
  const wallV = (x: number, z0: number, z1: number, doors: [number, number][] = []) => {
    for (let z = z0; z < z1; z++) plan.walls[vKey(x, z)] = doors.some(([a, b]) => z >= a && z < b) ? 2 : 1
  }
  const wallH = (z: number, x0: number, x1: number, doors: [number, number][] = []) => {
    for (let x = x0; x < x1; x++) plan.walls[hKey(x, z)] = doors.some(([a, b]) => x >= a && x < b) ? 2 : 1
  }
  const main = 12
  const wingEnd = level >= 4 ? 20 : 18
  if (level === 2) {
    paint(main, 18, 0, 9, 'bedroom')
    wallV(main, 0, 9, [[6, 8]])
    return plan
  }
  const n = 5
  const d = n + (level >= 5 ? 11 : 9)
  // Nhà nhiều tầng có cầu thang ở hai góc phía bắc: chừa mỗi góc thành một sảnh nhỏ riêng.
  const hallW = level >= 4 ? 2 : 0
  const hallE = level >= 5 ? 2 : 0
  paint(hallW, 8, 0, n, 'kitchen')
  paint(8, main, 0, n, 'bath')
  paint(main, wingEnd - hallE, 0, n, 'study')
  paint(main, wingEnd, n, d, 'bedroom')
  const doors: [number, number][] = [[5, 7], [8, 10], [14, 16]]
  if (hallW) doors.push([0, 2])
  if (hallE) doors.push([wingEnd - 2, wingEnd])
  wallH(n, 0, wingEnd, doors)
  if (hallW) wallV(hallW, 0, n)
  if (hallE) wallV(wingEnd - hallE, 0, n)
  wallV(8, 0, n)
  wallV(main, 0, d, [[d - 3, d - 1]])
  return plan
}

/** Màu hiển thị của các màu tường và mẫu sàn (dùng cho hiển thị 3D và các ô chọn trong giao diện). */
export const WALL_COLORS: Record<WallPaint, string> = {
  cream: '#f3e2c6',
  blush: '#f1cdc4',
  sky: '#cfe0f0',
  sage: '#d5e4c6',
  lavender: '#ddd2ee',
  butter: '#f6e7a8',
  white: '#f7f4ee',
  charcoal: '#5a5660',
}

export const FLOOR_SWATCH: Record<FloorId, string> = {
  plank: '#c28f5f',
  darkwood: '#86553a',
  tile_white: '#ece8de',
  tile_green: '#86bd90',
  tile_blue: '#9ccbd8',
  carpet_red: '#9a5a56',
  carpet_blue: '#6f81a8',
  carpet_purple: '#7f6aa5',
  stone: '#9a968e',
  marble: '#e4e0e6',
}
