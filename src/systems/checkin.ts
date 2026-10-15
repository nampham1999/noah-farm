import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { gainXp } from './progress.ts'

/**
 * Điểm danh mỗi ngày (theo ngày thật, giờ Việt Nam UTC+7, không phải ngày trong game).
 * Vào liên tiếp thì chuỗi tăng, 7 ngày một vòng; bỏ lỡ một ngày thì chuỗi về lại ngày 1.
 */
export const CHECKIN_REWARDS: { gold: number; xp: number }[] = [
  { gold: 50, xp: 5 },
  { gold: 80, xp: 8 },
  { gold: 120, xp: 10 },
  { gold: 160, xp: 12 },
  { gold: 220, xp: 15 },
  { gold: 300, xp: 20 },
  { gold: 600, xp: 40 },
]

const DAY_MS = 86_400_000
const TZ_MS = 7 * 3_600_000

/** Số thứ tự ngày thật (giờ Việt Nam). */
export function realDay(at = Date.now()): number {
  return Math.floor((at + TZ_MS) / DAY_MS)
}

export interface CheckinStatus {
  /** Hôm nay chưa điểm danh. */
  available: boolean
  /** Ngày thứ mấy trong vòng 7 ngày sẽ được nhận (1..7), hoặc đã nhận hôm nay thì là ngày vừa nhận. */
  day: number
  streak: number
}

export function checkinStatus(state: GameState, at = Date.now()): CheckinStatus {
  const today = realDay(at)
  const c = state.checkin
  if (c.day === today) return { available: false, day: ((c.streak - 1) % 7) + 1, streak: c.streak }
  const streak = c.day === today - 1 ? c.streak + 1 : 1
  return { available: true, day: ((streak - 1) % 7) + 1, streak }
}

/** Nhận quà hôm nay; trả về phần thưởng hoặc null nếu đã nhận rồi. */
export function claimCheckin(state: GameState, at = Date.now()): { gold: number; xp: number } | null {
  const s = checkinStatus(state, at)
  if (!s.available) return null
  const reward = CHECKIN_REWARDS[s.day - 1]
  state.checkin = { day: realDay(at), streak: s.streak }
  state.player.gold += reward.gold
  gainXp(state, reward.xp)
  bus.emit('notify', { key: 'checkin.claimed', params: { gold: reward.gold, day: s.day }, good: true })
  bus.emit('sfx', 'coin')
  bus.emit('saveRequest', undefined)
  return reward
}
