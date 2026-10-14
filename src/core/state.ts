/**
 * Kho trạng thái duy nhất của game (GDD mục 5, 6.3).
 * Hiển thị, giao diện và lưu trữ chỉ đọc hoặc ghi đối tượng này.
 */
import { balance, type AnimalType, type MachineId, type TreeId } from '../data/index.ts'
import { blockCells, greenhouseCells, SPAWN } from './world.ts'
import type { Look } from './look.ts'
import { randomFarmerName } from './names.ts'

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
  /** Đang ở trong nhà. */
  indoors: boolean
  /** Ngoại hình tự tạo; null là dùng nhân vật mẫu gốc của bản cũ. */
  look: Look | null
}

/** Đơn hàng của dân làng trên bảng đơn hàng (như bản cũ). */
export interface Order {
  id: number
  npc: string
  lines: { itemId: string; qty: number }[]
  gold: number
  xp: number
  /** Hạn giao: ngày game (dayStamp) cuối cùng còn giao được. */
  dueDay: number
  /** Đơn gấp: giao trong ngày, thưởng gấp đôi. */
  rush: boolean
  /** Tặng thêm khi giao (vd. 5 gói hạt). */
  bonus: { itemId: string; qty: number } | null
  /** Đơn kịch bản (lời nhắn riêng), vd. đơn đầu tiên của Cô Mia. */
  scripted: boolean
}

export interface DailyQuest {
  id: string
  target: number
  progress: number
}

export interface QuestState {
  /** Chỉ số nhiệm vụ hướng dẫn đang làm; bằng độ dài danh sách là đã xong hết. */
  step: number
  progress: number
  /** Nhiệm vụ hằng ngày của ngày game `day` (dayStamp). */
  daily: { day: number; list: DailyQuest[]; bonusClaimed: boolean }
}

/** Đồ nội thất đã đặt trong nhà: ô góc tây bắc của món đồ và hướng xoay (0..3, mỗi bước 90°). */
export interface PlacedFurniture {
  id: string
  cx: number
  cz: number
  rot: number
}

export type Weather = 'sunny' | 'rain' | 'storm' | 'snow'

export interface ClockState {
  day: number
  season: Season
  year: number
  minuteOfDay: number
  /** Thời tiết hôm nay, gieo lại mỗi sáng theo mùa. */
  weather: Weather
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

/** Máy chế biến đã mua: đang làm gì, xong lúc nào (dấu thời gian thật, chạy cả khi đóng tab). */
export interface MachineState {
  id: MachineId
  /** Vật phẩm sẽ ra khi xong; null là máy đang trống. */
  output: string | null
  qty: number
  readyAt: number
}

/** Chó nuôi: theo chân người chơi, vuốt ve mỗi ngày, sáng ra hay tìm được quà. */
export interface PetState {
  name: string
  /** dayStamp lần vuốt ve gần nhất. */
  pettedDay: number
  /** Quà đang ngậm chờ người chơi lấy: vật phẩm, hoặc vàng (id 'gold'). */
  gift: { id: string; qty: number } | null
}

/** Cây ăn quả trồng ở ô vườn số spot. */
export interface OrchardTree {
  spot: number
  type: TreeId
  plantedAt: number
  /** Lần hái gần nhất (dấu thời gian thật); null là chưa hái lần nào. */
  pickedAt: number | null
}

export interface AnimalState {
  id: string
  type: AnimalType
  name: string
  /** Lần cho ăn gần nhất (ms); no trong fullDays ngày game kể từ đó. null là chưa ăn. */
  fedAt: number | null
  /** Thời gian đã "làm việc" lúc no, tính bằng ms; đủ chu kỳ thì có sản phẩm. */
  progress: number
  /** 0..100; vui thì có lúc cho gấp đôi sản phẩm. */
  happiness: number
  /** Ngày game gần nhất đã được vuốt ve (dayStamp), để mỗi ngày chỉ tính một lần. */
  pettedDay: number
  /** Đã thuần (vui đạt 100 một lần); bò đã thuần thì cưỡi được. */
  tamed: boolean
}

export interface Settings {
  /** Âm lượng hiệu ứng, 0..1. */
  volume: number
  /** Âm lượng nhạc nền, 0..1. */
  musicVolume: number
  quality: Quality
  lang: Lang
  /** Mức zoom camera, giữ lại giữa các lần chơi. */
  zoom: number
  /** Báo lên máy khi cây chín, máy xong... lúc game chạy nền. */
  notify: boolean
}

export interface MetaState {
  /** Thời điểm tạo nông trại (ms). */
  createdAt: number
  /** Lần cuối người chơi xuất file hoặc mã sao lưu; null là chưa bao giờ. */
  lastBackupAt: number | null
  /** Mã mời riêng của nông trại này (link ?ref=). */
  inviteCode: string
  /** Mã mời đã dùng khi bắt đầu chơi (được tặng vàng); null nếu không. */
  referredBy: string | null
}

export interface GameState {
  version: 1
  meta: MetaState
  player: PlayerState
  clock: ClockState
  inventory: InventoryState
  plots: PlotState[]
  /** Số khu ruộng đã mua thêm (0..4); khu thứ i dùng LAND_BLOCKS[i]. */
  landLevel: number
  /** Cấp chuồng: 0 là chưa có chuồng. */
  coopLevel: number
  animals: AnimalState[]
  machines: MachineState[]
  pet: PetState | null
  /** Đã dựng nhà kính (luống 8 ô trồng được mọi mùa). */
  greenhouse: boolean
  /** Đã mua ngựa. */
  horse: boolean
  /** Đã rào bãi thả quanh chuồng (chặn cáo). */
  coopFence: boolean
  orchard: OrchardTree[]
  /** Thử thách lễ hội hôm nay: stamp là dayStamp của ngày lễ hội. */
  festival: { stamp: number; progress: number; done: boolean } | null
  /** Độ thân thiết với từng dân làng (theo id). */
  friends: Record<string, { points: number; giftDay: number; rewarded: number }>
  /** Sổ khách: bạn bè ghé thăm để lại câu chúc (mới nhất trước, tối đa 20). */
  guestbook: { from: string; text: string; at: number }[]
  /** Cược đua chó gần nhất: cuộc đua số id, chó, số vàng, tỉ lệ ăn lúc đặt, đã trả thưởng chưa. */
  race: { id: number; dog: number; amount: number; odds: number; paid: boolean } | null
  /** level: cấp nhà 1..5 (nhà to hơn, phòng rộng hơn). */
  house: { level: number; furniture: PlacedFurniture[] }
  /**
   * Nhật ký (GDD mục 3.7): sổ cá và sổ cây ghi số con đã câu / cây đã thu của từng loài;
   * achievements là các thành tựu đã đạt (để chỉ báo một lần).
   */
  journal: { fish: Record<string, number>; crops: Record<string, number>; achievements: string[] }
  /** Nhiệm vụ: bước hướng dẫn hiện tại và nhiệm vụ hằng ngày. */
  quests: QuestState
  /** lastRefill: ngày game (absDay) gần nhất đã thêm đơn mới; mỗi ngày chỉ thêm một lần. */
  orders: { nextId: number; list: Order[]; firstGiven: boolean; lastRefill: number }
  /** Số liệu cộng dồn cho thành tựu. */
  stats: { harvest: number; fish: number; goldEarned: number; shared: number }
  settings: Settings
}

export function createInitialState(): GameState {
  const slots: (ItemStack | null)[] = Array.from({ length: balance.inventorySize }, () => null)
  balance.startItems.forEach((stack, i) => (slots[i] = { ...stack }))

  const plots = blockPlots(0)

  return {
    version: 1,
    meta: { createdAt: Date.now(), lastBackupAt: null, inviteCode: randomCode(), referredBy: null },
    player: {
      name: randomFarmerName(detectLang()),
      gold: balance.startGold,
      xp: 0,
      level: 1,
      stamina: balance.staminaMax,
      pos: [SPAWN.x, 0, SPAWN.z],
      rotY: SPAWN.rotY,
      indoors: false,
      look: null,
    },
    clock: { day: 1, season: 'spring', year: 1, minuteOfDay: balance.dayStartMinute, weather: 'sunny' },
    inventory: { slots, selected: 0 },
    plots,
    landLevel: 0,
    coopLevel: 0,
    animals: [],
    machines: [],
    pet: null,
    greenhouse: false,
    horse: false,
    coopFence: false,
    orchard: [],
    festival: null,
    friends: {},
    guestbook: [],
    race: null,
    journal: { fish: {}, crops: {}, achievements: [] },
    quests: { step: 0, progress: 0, daily: { day: -1, list: [], bonusClaimed: false } },
    stats: { harvest: 0, fish: 0, goldEarned: 0, shared: 0 },
    orders: { nextId: 1, list: [], firstGiven: false, lastRefill: -1 },
    // Nhà mới có sẵn một giường đơn ở góc tây bắc.
    house: { level: 1, furniture: [{ id: 'bed_single', cx: 0, cz: 0, rot: 0 }] },
    settings: { volume: 0.7, musicVolume: 0.5, quality: 'auto', lang: detectLang(), zoom: 1, notify: false },
  }
}

function detectLang(): Lang {
  return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

/** Ô đất trống của luống nhà kính. */
export function greenhousePlots(): PlotState[] {
  return greenhouseCells().map(({ x, z }) => ({ x, z, tilled: false, crop: null, stage: 0, stageStartedAt: 0, wateredAt: null }))
}

/** Ô đất trống (cỏ) của khu ruộng thứ i. */
export function blockPlots(i: number): PlotState[] {
  return blockCells(i).map(({ x, z }) => ({ x, z, tilled: false, crop: null, stage: 0, stageStartedAt: 0, wateredAt: null }))
}

/** Mã mời ngắn, dễ đọc (bỏ các ký tự dễ nhầm như 0/O, 1/l). */
function randomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
