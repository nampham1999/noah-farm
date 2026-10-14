import { normalizeLook } from '../core/look.ts'
import { WEATHERS } from '../systems/weather.ts'
import { HOUSE_UPGRADES } from '../systems/house.ts'
import { blockPlots, createInitialState, greenhousePlots, type AnimalState, type GameState, type ItemStack, type Order, type PlotState, type QuestState } from '../core/state.ts'
import { FARM_HALF, isWater, LAND_BLOCKS, SPAWN } from '../core/world.ts'
import { ANIMAL_BY_ID, animalData, balance, CROP_BY_ID, FURNITURE_BY_ID, ITEMS, MACHINE_BY_ID, ORCHARD, TREE_BY_ID, type AnimalType, type MachineId, type TreeId } from '../data/index.ts'
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
  const greenhouse = data.greenhouse === true
  const expected = [...Array.from({ length: landLevel + 1 }, (_, i) => blockPlots(i)).flat(), ...(greenhouse ? greenhousePlots() : [])]
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
    player: { ...base.player, ...p, look: normalizeLook(p.look), ...outdoorPos(p) },
    clock: { ...base.clock, ...obj(data.clock), weather: normalizeWeather(obj(data.clock).weather) },
    inventory: { slots, selected: Math.max(0, Math.min(balance.toolbarSize - 1, selected)) },
    plots,
    landLevel,
    coopLevel,
    animals,
    pet: normalizePet(data.pet),
    greenhouse,
    horse: data.horse === true,
    race: (() => {
      const r = obj(data.race)
      return typeof r.id === 'number' && typeof r.dog === 'number' && typeof r.amount === 'number'
        ? { id: r.id, dog: Math.max(0, Math.min(4, Math.floor(r.dog))), amount: Math.max(0, r.amount), odds: num(r.odds, 1), paid: r.paid === true, period: typeof r.period === 'number' ? r.period : undefined }
        : null
    })(),
    guestbook: (Array.isArray(data.guestbook) ? data.guestbook : []).flatMap((raw) => {
      const g = obj(raw)
      return typeof g.from === 'string' && typeof g.text === 'string' ? [{ from: g.from.slice(0, 20), text: g.text.slice(0, 40), at: num(g.at, 0) }] : []
    }).slice(0, 20),
    coopFence: data.coopFence === true,
    friends: Object.fromEntries(Object.entries(obj(data.friends)).map(([id, raw]) => {
      const f = obj(raw)
      return [id, { points: Math.max(0, num(f.points, 0)), giftDay: num(f.giftDay, -1), rewarded: Math.max(0, num(f.rewarded, 0)) }]
    })),
    festival: (() => {
      const f = obj(data.festival)
      return typeof f.stamp === 'number' ? { stamp: f.stamp, progress: Math.max(0, num(f.progress, 0)), done: f.done === true } : null
    })(),
    orchard: (Array.isArray(data.orchard) ? data.orchard : []).flatMap((raw): GameState['orchard'] => {
      const o = obj(raw)
      const spot = Math.floor(num(o.spot, -1))
      if (spot < 0 || spot >= ORCHARD.spots.length || typeof o.type !== 'string' || !TREE_BY_ID.has(o.type as TreeId)) return []
      return [{ spot, type: o.type as TreeId, plantedAt: num(o.plantedAt, 0), pickedAt: typeof o.pickedAt === 'number' ? o.pickedAt : null }]
    }).filter((t, i, all) => all.findIndex((o) => o.spot === t.spot) === i),
    machines: (Array.isArray(data.machines) ? data.machines : []).flatMap((raw): GameState['machines'] => {
      const m = obj(raw)
      if (typeof m.id !== 'string' || !MACHINE_BY_ID.has(m.id as MachineId)) return []
      const output = typeof m.output === 'string' && ITEMS.has(m.output) ? m.output : null
      return [{ id: m.id as MachineId, output, qty: output ? Math.max(1, Math.floor(num(m.qty, 1))) : 0, readyAt: num(m.readyAt, 0) }]
    }).filter((m, i, all) => all.findIndex((o) => o.id === m.id) === i),
    house: Array.isArray(obj(data.house).furniture)
      ? {
          level: Math.max(1, Math.min(HOUSE_UPGRADES.length + 1, Math.floor(num(obj(data.house).level, 1)))),
          furniture: (obj(data.house).furniture as unknown[]).flatMap((raw) => {
            const f = obj(raw)
            return typeof f.id === 'string' && FURNITURE_BY_ID.has(f.id)
              ? [{ id: f.id, cx: Math.floor(num(f.cx, 0)), cz: Math.floor(num(f.cz, 0)), rot: Math.floor(num(f.rot, 0)) & 3 }]
              : []
          }),
        }
      : base.house,
    journal: {
      fish: counts(obj(obj(data.journal).fish)),
      crops: counts(obj(obj(data.journal).crops)),
      achievements: (Array.isArray(obj(data.journal).achievements) ? (obj(data.journal).achievements as unknown[]) : []).filter((a): a is string => typeof a === 'string'),
    },
    quests: normalizeQuests(obj(data.quests), base.quests),
    orders: normalizeOrders(obj(data.orders), base.orders),
    stats: { ...base.stats, ...counts(obj(data.stats)) },
    settings: { ...base.settings, ...obj(data.settings) },
  } as GameState
}

/** Giữ các cặp khoá: số dương. */
function counts(o: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>
}

function normalizeQuests(q: Record<string, unknown>, base: QuestState): QuestState {
  const daily = q.daily && typeof q.daily === 'object' ? (q.daily as Record<string, unknown>) : {}
  const list = Array.isArray(daily.list) ? daily.list : []
  return {
    step: typeof q.step === 'number' ? Math.max(0, Math.floor(q.step)) : base.step,
    progress: typeof q.progress === 'number' ? q.progress : 0,
    daily: {
      day: typeof daily.day === 'number' ? daily.day : -1,
      bonusClaimed: daily.bonusClaimed === true,
      list: list.flatMap((raw) => {
        const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
        return typeof d.id === 'string' && typeof d.target === 'number'
          ? [{ id: d.id, target: d.target, progress: typeof d.progress === 'number' ? d.progress : 0 }]
          : []
      }),
    },
  }
}

function normalizeOrders(o: Record<string, unknown>, base: GameState['orders']): GameState['orders'] {
  const list = (Array.isArray(o.list) ? o.list : []).flatMap((raw): Order[] => {
    const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const lines = (Array.isArray(d.lines) ? d.lines : []).flatMap((l) => {
      const x = l && typeof l === 'object' ? (l as Record<string, unknown>) : {}
      return typeof x.itemId === 'string' && ITEMS.has(x.itemId) && typeof x.qty === 'number' ? [{ itemId: x.itemId, qty: x.qty }] : []
    })
    if (typeof d.id !== 'number' || typeof d.npc !== 'string' || lines.length === 0) return []
    const bonus = d.bonus && typeof d.bonus === 'object' ? (d.bonus as Record<string, unknown>) : null
    return [{
      id: d.id,
      npc: d.npc,
      lines,
      gold: typeof d.gold === 'number' ? d.gold : 0,
      xp: typeof d.xp === 'number' ? d.xp : 0,
      dueDay: typeof d.dueDay === 'number' ? d.dueDay : 0,
      rush: d.rush === true,
      bonus: bonus && typeof bonus.itemId === 'string' && ITEMS.has(bonus.itemId) && typeof bonus.qty === 'number' ? { itemId: bonus.itemId, qty: bonus.qty } : null,
      scripted: d.scripted === true,
    }]
  })
  return {
    nextId: typeof o.nextId === 'number' ? o.nextId : base.nextId,
    list,
    firstGiven: o.firstGiven === true,
    lastRefill: typeof o.lastRefill === 'number' ? o.lastRefill : -1,
  }
}

/**
 * Vị trí ngoài trời đọc từ file lưu: nếu nằm ngoài rào hoặc dưới nước (ví dụ bố cục nông trại
 * đã đổi từ lần chơi trước) thì đưa về chỗ xuất hiện.
 */
function outdoorPos(p: Record<string, unknown>): { pos?: [number, number, number]; rotY?: number } {
  const pos = p.pos
  if (p.indoors === true) return {}
  const ok =
    Array.isArray(pos) &&
    pos.length === 3 &&
    pos.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(pos[0]) < FARM_HALF - 0.5 &&
    Math.abs(pos[2]) < FARM_HALF - 0.5 &&
    !isWater(pos[0], pos[2], 0.3)
  return ok ? {} : { pos: [SPAWN.x, 0, SPAWN.z], rotY: SPAWN.rotY }
}

function normalizeWeather(v: unknown): GameState['clock']['weather'] {
  return WEATHERS.includes(v as GameState['clock']['weather']) ? (v as GameState['clock']['weather']) : 'sunny'
}

function normalizePet(v: unknown): GameState['pet'] {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const g = p.gift as Record<string, unknown> | null | undefined
  const gift = g && typeof g.id === 'string' && (g.id === 'gold' || ITEMS.has(g.id)) && typeof g.qty === 'number' && g.qty > 0 ? { id: g.id, qty: Math.floor(g.qty) } : null
  return {
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 16) : 'Lu',
    pettedDay: typeof p.pettedDay === 'number' ? p.pettedDay : -1,
    gift,
  }
}
