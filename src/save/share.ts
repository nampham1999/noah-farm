import { blockPlots, createInitialState, type GameState, type Season } from '../core/state.ts'
import { LAND_BLOCKS } from '../core/world.ts'
import { ANIMAL_BY_ID, CROPS, FURNITURE, type AnimalType } from '../data/index.ts'
import { SEASONS } from '../systems/clock.ts'
import { gunzipBase64Url, gzipBase64Url } from './codec.ts'

/**
 * Link chia sẻ nông trại (GDD mục 8.1): "ảnh chụp" gọn gồm tên, cấp, ruộng, vật nuôi,
 * nội thất; không có vàng hay túi đồ. Nén gzip + base64url, đặt sau dấu # nên không
 * gửi lên máy chủ nào.
 */

const VERSION = 1
/** Mục tiêu độ dài link (ký tự) để dán được vào mọi ứng dụng chat. */
export const MAX_SHARE_CHARS = 2000

interface Snapshot {
  v: number
  /** Tên, cấp, mùa (chỉ số), số khu ruộng, cấp chuồng. */
  n: string
  l: number
  s: number
  land: number
  coop: number
  /** Ô có cây: [cột, hàng, chỉ số cây, giai đoạn] nối liền. Ô đã cuốc mà trống: [cột, hàng]. */
  p: number[]
  t: number[]
  /** Vật nuôi: chỉ số loài (0 gà, 1 lợn, 2 bò). */
  a: number[]
  /** Nội thất: [chỉ số món, cx, cz, xoay] nối liền. */
  f: number[]
}

const ANIMAL_TYPES = [...ANIMAL_BY_ID.keys()] as AnimalType[]

function snapshotOf(state: GameState, detail: 'full' | 'lite'): Snapshot {
  const p: number[] = []
  const t: number[] = []
  for (const plot of state.plots) {
    if (plot.crop) p.push(plot.x, plot.z, CROPS.findIndex((c) => c.id === plot.crop), plot.stage)
    else if (plot.tilled && detail === 'full') t.push(plot.x, plot.z)
  }
  return {
    v: VERSION,
    n: state.player.name.slice(0, 20),
    l: state.player.level,
    s: SEASONS.indexOf(state.clock.season),
    land: state.landLevel,
    coop: state.coopLevel,
    p,
    t,
    a: state.animals.map((a) => ANIMAL_TYPES.indexOf(a.type)),
    f: state.house.furniture.flatMap((f) => [FURNITURE.findIndex((d) => d.id === f.id), f.cx, f.cz, f.rot]),
  }
}

/** Tạo phần dữ liệu cho link; nông trại quá lớn thì bỏ bớt ô đã cuốc mà trống (ưu tiên cây và nội thất). */
export async function encodeFarm(state: GameState): Promise<string> {
  let data = await gzipBase64Url(JSON.stringify(snapshotOf(state, 'full')))
  if (data.length > MAX_SHARE_CHARS - 100) data = await gzipBase64Url(JSON.stringify(snapshotOf(state, 'lite')))
  return `v${VERSION}.${data}`
}

export function shareUrl(data: string): string {
  return `${location.origin}${location.pathname}#visit=${data}`
}

/** Link mời: người mới mở được tặng vàng (GDD mục 8.2). */
export function inviteUrl(code: string): string {
  return `${location.origin}${location.pathname}?ref=${encodeURIComponent(code)}`
}

/** Dựng một trạng thái chỉ để xem từ link chia sẻ. Ném lỗi nếu link hỏng. */
export async function decodeFarm(raw: string): Promise<GameState> {
  const m = /^v(\d+)\.(.+)$/.exec(raw)
  if (!m || Number(m[1]) !== VERSION) throw new Error('Unsupported share link')
  const snap = JSON.parse(await gunzipBase64Url(m[2])) as Snapshot
  const state = createInitialState()
  state.player.name = String(snap.n ?? '').slice(0, 20) || '?'
  state.player.level = Math.max(1, Math.floor(Number(snap.l) || 1))
  state.clock.season = (SEASONS[snap.s] ?? 'spring') as Season
  state.landLevel = Math.max(0, Math.min(LAND_BLOCKS.length - 1, Math.floor(Number(snap.land) || 0)))
  state.plots = Array.from({ length: state.landLevel + 1 }, (_, i) => blockPlots(i)).flat()
  state.coopLevel = Math.max(0, Math.min(2, Math.floor(Number(snap.coop) || 0)))
  const at = (x: number, z: number) => state.plots.find((pl) => pl.x === x && pl.z === z)
  const crops = snap.p ?? []
  for (let i = 0; i + 3 < crops.length; i += 4) {
    const plot = at(crops[i], crops[i + 1])
    const crop = CROPS[crops[i + 2]]
    if (!plot || !crop) continue
    // Cây đứng yên ở giai đoạn trong ảnh chụp: không có dấu tưới nên không lớn tiếp.
    Object.assign(plot, { tilled: true, crop: crop.id, stage: Math.max(0, Math.min(3, crops[i + 3])), stageStartedAt: Date.now(), wateredAt: null })
  }
  for (let i = 0; i + 1 < (snap.t ?? []).length; i += 2) {
    const plot = at(snap.t[i], snap.t[i + 1])
    if (plot) plot.tilled = true
  }
  state.animals = (snap.a ?? []).flatMap((idx, i) => {
    const type = ANIMAL_TYPES[idx]
    return type ? [{ id: `v${i}`, type, name: '', fedAt: null, progress: 0, happiness: 60, pettedDay: -1, tamed: false }] : []
  })
  state.house.furniture = []
  for (let i = 0; i + 3 < (snap.f ?? []).length; i += 4) {
    const def = FURNITURE[snap.f[i]]
    if (def) state.house.furniture.push({ id: def.id, cx: snap.f[i + 1], cz: snap.f[i + 2], rot: snap.f[i + 3] & 3 })
  }
  // Không hiện đơn hàng và nhiệm vụ của người chơi khác.
  state.orders.firstGiven = true
  return state
}
