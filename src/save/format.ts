import { blockPlots, createInitialState, type AnimalState, type GameState, type ItemStack, type PlotState } from '../core/state.ts'
import { LAND_BLOCKS } from '../core/world.ts'
import { ANIMAL_BY_ID, animalData, balance, CROP_BY_ID, FURNITURE_BY_ID, ITEMS, type AnimalType } from '../data/index.ts'
import { migrate, SAVE_VERSION } from './migrate.ts'

/**
 * Dạng lưu: chính GameState kèm thời điểm lưu và mã kiểm tra (GDD mục 6.3).
 * Checksum chỉ để phát hiện file hỏng, không chống gian lận (GDD mục 6.2).
 */
export interface SaveFile extends GameState {
  savedAt: number
  checksum: string
}

export type SaveErrorReason = 'corrupt' | 'checksum' | 'tooNew' | 'invalid'

export class SaveError extends Error {
  readonly reason: SaveErrorReason
  constructor(reason: SaveErrorReason, cause?: unknown) {
    super(`Save error: ${reason}`, { cause })
    this.name = 'SaveError'
    this.reason = reason
  }
}

export interface ParsedSave {
  state: GameState
  savedAt: number
  /** Bản gốc trước khi nâng cấp; null nếu đã là bản mới nhất. */
  migratedFrom: number | null
}

export function serialize(state: GameState, savedAt: number): string {
  const body = JSON.stringify({ ...state, savedAt })
  // Chèn checksum làm trường cuối để lúc kiểm tra chỉ cần bỏ nó đi rồi băm lại.
  return `${body.slice(0, -1)},"checksum":"${checksum(body)}"}`
}

export function parseSave(text: string): ParsedSave {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new SaveError('corrupt', e)
  }
  if (!raw || typeof raw !== 'object' || typeof raw.version !== 'number') throw new SaveError('invalid')

  if (typeof raw.checksum === 'string') {
    const { checksum: expected, ...rest } = raw
    if (checksum(JSON.stringify(rest)) !== expected) throw new SaveError('checksum')
  }
  if (raw.version > SAVE_VERSION) throw new SaveError('tooNew')

  const from = raw.version
  let data: Record<string, unknown>
  try {
    data = migrate(raw as Record<string, unknown> & { version: number })
  } catch (e) {
    throw new SaveError('invalid', e)
  }
  return {
    state: normalize(data),
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
    migratedFrom: from < SAVE_VERSION ? from : null,
  }
}

/** Đọc nhanh thời điểm lưu mà không kiểm tra gì, để chọn bản mới hơn giữa hai kho. */
export function peekSavedAt(text: string): number {
  const m = /"savedAt":(\d+)/.exec(text)
  return m ? Number(m[1]) : 0
}

/** FNV-1a 32 bit: nhanh, đủ để phát hiện dữ liệu bị cắt hoặc sửa nhầm. */
export function checksum(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Ghép dữ liệu đọc được lên trạng thái mặc định: trường thiếu lấy giá trị mặc định,
 * vật phẩm hoặc cây không còn tồn tại thì bỏ, để game không lỗi khi dữ liệu tĩnh đổi.
 */
function normalize(data: Record<string, unknown>): GameState {
  const base = createInitialState()
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const p = obj(data.player)
  const inv = obj(data.inventory)

  if (typeof p.gold !== 'number' || !Array.isArray(inv.slots) || !Array.isArray(data.plots)) {
    throw new SaveError('invalid')
  }

  const slots = (inv.slots as unknown[]).map((s): ItemStack | null => {
    const st = obj(s)
    return typeof st.id === 'string' && ITEMS.has(st.id) && typeof st.qty === 'number' && st.qty > 0
      ? { id: st.id, qty: Math.floor(st.qty) }
      : null
  })
  while (slots.length < balance.inventorySize) slots.push(null)

  const savedPlots = new Map<string, Record<string, unknown>>()
  for (const raw of data.plots as unknown[]) {
    const pl = obj(raw)
    savedPlots.set(`${pl.x},${pl.z}`, pl)
  }
  const landLevel = Math.max(0, Math.min(LAND_BLOCKS.length - 1, Math.floor(typeof data.landLevel === 'number' ? data.landLevel : 0)))
  const expected = Array.from({ length: landLevel + 1 }, (_, i) => blockPlots(i)).flat()
  const plots = expected.map((def): PlotState => {
    const pl = savedPlots.get(`${def.x},${def.z}`)
    if (!pl) return def
    const crop = typeof pl.crop === 'string' && CROP_BY_ID.has(pl.crop) ? pl.crop : null
    return {
      ...def,
      tilled: pl.tilled === true,
      crop,
      stage: crop && typeof pl.stage === 'number' ? Math.min(pl.stage, balance.cropStages) : 0,
      stageStartedAt: typeof pl.stageStartedAt === 'number' ? pl.stageStartedAt : 0,
      wateredAt: crop && typeof pl.wateredAt === 'number' ? pl.wateredAt : null,
    }
  })

  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const coopLevel = Math.max(0, Math.min(animalData.coopLevels.length, Math.floor(num(data.coopLevel, 0))))
  const animals = (Array.isArray(data.animals) ? data.animals : []).flatMap((raw): AnimalState[] => {
    const a = obj(raw)
    if (typeof a.type !== 'string' || !ANIMAL_BY_ID.has(a.type as AnimalType)) return []
    return [{
      id: typeof a.id === 'string' ? a.id : `a${Math.random().toString(36).slice(2, 8)}`,
      type: a.type as AnimalType,
      name: typeof a.name === 'string' ? a.name : '',
      fedAt: typeof a.fedAt === 'number' ? a.fedAt : null,
      progress: Math.max(0, num(a.progress, 0)),
      happiness: Math.max(0, Math.min(100, num(a.happiness, 50))),
      pettedDay: num(a.pettedDay, -1),
      tamed: a.tamed === true,
    }]
  })

  const selected = typeof inv.selected === 'number' ? inv.selected : 0
  return {
    version: SAVE_VERSION,
    meta: { ...base.meta, ...obj(data.meta) },
    player: { ...base.player, ...p },
    clock: { ...base.clock, ...obj(data.clock) },
    inventory: { slots, selected: Math.max(0, Math.min(balance.toolbarSize - 1, selected)) },
    plots,
    landLevel,
    coopLevel,
    animals,
    house: Array.isArray(obj(data.house).furniture)
      ? {
          furniture: (obj(data.house).furniture as unknown[]).flatMap((raw) => {
            const f = obj(raw)
            return typeof f.id === 'string' && FURNITURE_BY_ID.has(f.id)
              ? [{ id: f.id, cx: Math.floor(num(f.cx, 0)), cz: Math.floor(num(f.cz, 0)), rot: Math.floor(num(f.rot, 0)) & 3 }]
              : []
          }),
        }
      : base.house,
    journal: {
      fish: Object.fromEntries(
        Object.entries(obj(obj(data.journal).fish)).filter(([, v]) => typeof v === 'number' && v > 0),
      ) as Record<string, number>,
    },
    settings: { ...base.settings, ...obj(data.settings) },
  } as GameState
}
