import type { Lang, Season, Weather } from './state.ts'

/** Hành động của người chơi, dùng chung cho bàn phím và cảm ứng (GDD mục 4). */
export type GameAction =
  | 'useTool'
  | 'interact'
  | 'ride'
  | 'eat'
  | 'inventory'
  | 'journal'
  | 'menu'
  | 'social'
  | 'news'
  | 'character'

/** Thông báo ngắn cho người chơi; key là khoá i18n, HUD tự dịch. */
export interface Notice {
  key: string
  params?: Record<string, string | number>
  /** Thông báo vui (lên cấp, thu hoạch) hiện kiểu khác thông báo lỗi. */
  good?: boolean
}

/** Việc người chơi vừa làm, để tính nhiệm vụ và thành tựu. */
export interface Progress {
  type: 'till' | 'plant' | 'water' | 'harvest' | 'sell' | 'sellGold' | 'fish' | 'coop' | 'collect' | 'place' | 'deliver' | 'forage'
  amount: number
  /** Loài cây / cá liên quan, nếu có. */
  id?: string
}

export interface GameEvents {
  action: GameAction
  /** Số ô 1..9 trên thanh công cụ. */
  selectSlot: number
  /** Lăn chuột: +1 sang ô kế, -1 về ô trước trên thanh công cụ. */
  cycleSlot: number
  /** Chạm hoặc click (không kéo) lên canvas, toạ độ màn hình. */
  tap: { x: number; y: number }
  notify: Notice
  progress: Progress
  /** Phát một hiệu ứng âm thanh theo tên (xem audio/sound.ts). */
  sfx: string
  /** Người chơi vừa đổi âm lượng trong menu. */
  volumeChanged: undefined
  /** Người chơi vừa đổi ngoại hình nhân vật. */
  lookChanged: undefined
  /** Người chơi vừa bật/tắt tiết kiệm pin. */
  qualityChanged: undefined
  levelUp: number
  /** Sang ngày mới trong game (số ngày trong mùa). */
  newDay: number
  seasonChanged: Season
  /** Thời tiết vừa đổi (sáng ngày mới, hoặc lúc gỡ lỗi). */
  weatherChanged: Weather
  /** Nhà vừa lên cấp (1..5). */
  houseUpgraded: number
  /** Trạng thái online (kết nối, bạn bè) vừa đổi. */
  onlineChanged: undefined
  /** Có tin chat mới hoặc số tin chưa đọc đổi. */
  chatChanged: undefined
  /** Có người vào/ra phòng hoặc đổi vị trí (gặp nhau trực tiếp). */
  presenceChanged: undefined
  /** Một người trong phòng vừa gửi biểu cảm (uid; '' là chính mình). */
  presenceEmote: string
  /** Thách đấu đổi trạng thái hoặc điểm. */
  contestChanged: undefined
  villageChanged: undefined
  /** Có thay đổi lớn (thu hoạch, mua, bán...): lưu sớm thay vì chờ chu kỳ 30 giây. */
  saveRequest: undefined
  langChanged: Lang
}

type Handler<T> = (payload: T) => void

export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(fn as Handler<never>)
    return () => set.delete(fn as Handler<never>)
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<Events[K]>)(payload))
  }
}

export const bus = new EventBus<GameEvents>()
