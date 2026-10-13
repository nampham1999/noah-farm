/**
 * Kho trạng thái duy nhất của game (GDD mục 5, 6.3).
 * Hiển thị, giao diện và lưu trữ chỉ đọc hoặc ghi đối tượng này.
 */
import { balance } from '../data/index.ts'
import { PLOT_AREA } from './world.ts'

export type Lang = 'vi' | 'en'
export type Quality = 'auto' | 'low' | 'high'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export interface PlayerState {
  name: string
  gold: number
  /** XP trong cấp hiện tại; về 0 khi lên cấp. */
  xp: number
  level: number
  stamina: number
  pos: [number, number, number]
  /** Hướng nhân vật quay mặt, radian quanh trục Y. */
  rotY: number
}

export interface ClockState {
  day: number
  season: Season
  year: number
  minuteOfDay: number
}

export interface ItemStack {
  id: string
  qty: number
}

export interface InventoryState {
  /** Ô 0..toolbarSize-1 là thanh công cụ. */
  slots: (ItemStack | null)[]
  /** Ô đang chọn trên thanh công cụ. */
  selected: number
}

export interface PlotState {
  /** Cột và hàng trong khu ô đất. */
  x: number
  z: number
  tilled: boolean
  crop: string | null
  /** 0..cropStages-1 là đang lớn, bằng cropStages là đã chín. */
  stage: number
  /** Thời điểm (ms) bắt đầu giai đoạn hiện tại. */
  stageStartedAt: number
  /** Thời điểm tưới trong giai đoạn hiện tại; null là chưa tưới. */
  wateredAt: number | null
}

export interface Settings {
  volume: number
  quality: Quality
  lang: Lang
  /** Mức zoom camera, giữ lại giữa các lần chơi. */
  zoom: number
}

export interface MetaState {
  /** Thời điểm tạo nông trại (ms). */
  createdAt: number
  /** Lần cuối người chơi xuất file hoặc mã sao lưu; null là chưa bao giờ. */
  lastBackupAt: number | null
}

export interface GameState {
  version: 1
  meta: MetaState
  player: PlayerState
  clock: ClockState
  inventory: InventoryState
  plots: PlotState[]
  settings: Settings
}

export function createInitialState(): GameState {
  const slots: (ItemStack | null)[] = Array.from({ length: balance.inventorySize }, () => null)
  balance.startItems.forEach((stack, i) => (slots[i] = { ...stack }))

  const plots: PlotState[] = []
  for (let x = 0; x < PLOT_AREA.cols; x++) {
    for (let z = 0; z < PLOT_AREA.rows; z++) {
      plots.push({ x, z, tilled: false, crop: null, stage: 0, stageStartedAt: 0, wateredAt: null })
    }
  }

  return {
    version: 1,
    meta: { createdAt: Date.now(), lastBackupAt: null },
    player: {
      name: 'Mia',
      gold: balance.startGold,
      xp: 0,
      level: 1,
      stamina: balance.staminaMax,
      pos: [0, 0, 6],
      rotY: Math.PI,
    },
    clock: { day: 1, season: 'spring', year: 1, minuteOfDay: balance.dayStartMinute },
    inventory: { slots, selected: 0 },
    plots,
    settings: { volume: 0.7, quality: 'auto', lang: detectLang(), zoom: 1 },
  }
}

function detectLang(): Lang {
  return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}
