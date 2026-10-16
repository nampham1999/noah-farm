import type { Card } from './cards.ts'

export type GameId = 'mauBinh' | 'tienLen' | 'xiDach' | 'phom'

export interface Seat {
  uid: string
  name: string
}

/**
 * Một ván đang chơi. pub là phần ai cũng thấy (ghi vào bàn), hands là bài kín của từng người
 * (chỉ chủ bàn giữ đủ, mỗi người chỉ nhận bài của mình). Cả hai chỉ chứa số, chuỗi, mảng, đối tượng
 * thuần để lưu thành JSON.
 */
export interface Round {
  pub: Record<string, unknown>
  hands: Record<string, Card[]>
  /** Dữ liệu kín của chủ bàn (nước đi chưa lật, bài úp…), không bao giờ gửi đi. */
  secret?: Record<string, unknown>
}

/** Luật của một game bài; chủ bàn chạy các hàm này, người chơi chỉ gửi nước đi. */
export interface Engine {
  id: GameId
  min: number
  max: number
  /** Số vàng tối đa một người có thể mất trong một ván (để giữ cọc). */
  maxLoss(stake: number, players: number): number
  deal(seats: Seat[], rand: () => number, now: number): Round
  /** Áp dụng nước đi của uid; trả về lý do từ chối, hoặc null nếu hợp lệ. */
  move(round: Round, uid: string, move: unknown, now: number): string | null
  /** Hết giờ: tự đánh thay người chậm. Trả về true nếu có thay đổi. */
  tick(round: Round, now: number): boolean
  /** Thắng thua (vàng, đã nhân mức cược) khi ván kết thúc, chưa kết thúc thì null. */
  result(round: Round, stake: number): Record<string, number> | null
}
