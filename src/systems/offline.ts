import type { GameState } from '../core/state.ts'
import { isRipe, shiftTimestamps, updateCrops } from './farming.ts'

/** Tính bù tối đa 7 ngày để tránh con số quá lớn (GDD mục 6.4). */
export const MAX_OFFLINE_MS = 7 * 24 * 60 * 60 * 1000

export interface OfflineReport {
  /** Thời gian vắng đã được tính bù (ms). */
  elapsed: number
  /** Số ô vừa chín trong lúc vắng. */
  newlyRipe: number
}

/**
 * Tính bù cho cây trồng khi mở lại game. Đồng hồ ngày và mùa trong game không chạy
 * khi đóng tab nên không đụng tới ở đây.
 */
export function applyOfflineProgress(state: GameState, savedAt: number, t: number): OfflineReport {
  if (!savedAt) return { elapsed: 0, newlyRipe: 0 }
  const ripeBefore = state.plots.filter(isRipe).length
  const elapsed = t - savedAt

  if (elapsed < 0) {
    // Đồng hồ máy bị đổi lùi: coi như không vắng, kéo dấu thời gian về cho khớp.
    shiftTimestamps(state, elapsed)
    return { elapsed: 0, newlyRipe: 0 }
  }

  if (elapsed > MAX_OFFLINE_MS) {
    updateCrops(state, savedAt + MAX_OFFLINE_MS, savedAt)
    // Phần vượt giới hạn coi như không trôi qua với cây.
    shiftTimestamps(state, elapsed - MAX_OFFLINE_MS)
  } else {
    updateCrops(state, t, savedAt)
  }

  return {
    elapsed: Math.min(elapsed, MAX_OFFLINE_MS),
    newlyRipe: state.plots.filter(isRipe).length - ripeBefore,
  }
}
