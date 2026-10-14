import { bus } from '../core/events.ts'
import { mulberry32 } from '../core/random.ts'
import type { GameState } from '../core/state.ts'

/**
 * Trường đua chó ở làng. Cứ RACE_PERIOD_MS có một cuộc đua: mở cược BET_MS đầu, đua RUN_MS,
 * rồi hiện kết quả. Phong độ, tỉ lệ ăn, người thắng và diễn biến cuộc đua đều tính từ số
 * thứ tự cuộc đua (hạt giống), nên mọi máy thấy cùng một cuộc đua mà không cần máy chủ.
 * Chỉ cược bằng vàng trong game; tỉ lệ ăn có phần lời cho nhà cái để không "cày" vàng được.
 */

export const RACE_PERIOD_MS = 5 * 60_000
export const BET_MS = 4 * 60_000
export const RUN_MS = 20_000
export const MIN_BET = 50
export const MAX_BET = 500
/** Phần lời của nhà cái: tỉ lệ ăn = (1 - HOUSE_EDGE) / xác suất thắng. */
const HOUSE_EDGE = 0.1

export const DOGS = [
  { name: 'Lu', color: '#e0704a' },
  { name: 'Mực', color: '#3a3a40' },
  { name: 'Vàng', color: '#f2c75c' },
  { name: 'Bông', color: '#f4efe2' },
  { name: 'Cà Phê', color: '#8a5a2f' },
]

export type RacePhase = 'betting' | 'running' | 'results'

export interface Race {
  id: number
  phase: RacePhase
  /** Mốc bắt đầu cuộc đua (ms) và thời gian còn lại của giai đoạn hiện tại. */
  startAt: number
  left: number
  /** Tỉ lệ ăn của từng chó (cược 100 thắng thì nhận 100 × tỉ lệ). */
  odds: number[]
  winner: number
  /** Thời gian về đích của từng chó (0..1 tính theo RUN_MS); chó thắng về sớm nhất. */
  finish: number[]
}

/** Cuộc đua đang diễn ra (hoặc sắp diễn ra) ở thời điểm now. */
export function raceAt(now = Date.now()): Race {
  const id = Math.floor(now / RACE_PERIOD_MS)
  return raceById(id, now)
}

export function raceById(id: number, now = Date.now()): Race {
  const rand = mulberry32(id * 2654435761)
  // Phong độ ngẫu nhiên → xác suất thắng → tỉ lệ ăn.
  const form = DOGS.map(() => 0.6 + rand() * 1.4)
  const total = form.reduce((a, b) => a + b, 0)
  const prob = form.map((f) => f / total)
  const odds = prob.map((p) => Math.max(1.1, Math.round(((1 - HOUSE_EDGE) / p) * 10) / 10))
  let r = rand()
  let winner = DOGS.length - 1
  for (let i = 0; i < prob.length; i++) {
    if (r < prob[i]) {
      winner = i
      break
    }
    r -= prob[i]
  }
  // Về đích: chó thắng sớm nhất, các chó khác chậm hơn một chút (khoảng cách ngẫu nhiên).
  const finish = DOGS.map((_, i) => (i === winner ? 0.82 : 0.86 + rand() * 0.14))
  const startAt = id * RACE_PERIOD_MS
  const t = now - startAt
  const phase: RacePhase = t < BET_MS ? 'betting' : t < BET_MS + RUN_MS ? 'running' : 'results'
  const left = phase === 'betting' ? BET_MS - t : phase === 'running' ? BET_MS + RUN_MS - t : RACE_PERIOD_MS - t
  return { id, phase, startAt, left, odds, winner, finish }
}

/** Quãng đường (0..1) của chó i ở thời điểm u (0..1 của RUN_MS): tăng tốc rồi chạy đều, có chút nhấp nhô. */
export function dogProgress(race: Race, i: number, u: number): number {
  const f = race.finish[i]
  const k = Math.min(1, u / f)
  const wobble = Math.sin(u * 30 + i * 1.7) * 0.012 * (1 - k)
  return Math.min(1, Math.max(0, k * k * (3 - 2 * k) * 0.35 + k * 0.65 + wobble))
}

/** Đặt cược cho cuộc đua đang mở; trừ vàng ngay. */
export function placeBet(state: GameState, dog: number, amount: number): boolean {
  const race = raceAt()
  if (race.phase !== 'betting') return fail('race.closed')
  if (state.race?.id === race.id) return fail('race.already')
  amount = Math.floor(Math.max(MIN_BET, Math.min(MAX_BET, amount)))
  if (state.player.gold < amount) return fail('notice.noGold')
  state.player.gold -= amount
  state.race = { id: race.id, dog, amount, odds: race.odds[dog], paid: false }
  bus.emit('notify', { key: 'race.betPlaced', params: { dog: DOGS[dog].name, amount, odds: race.odds[dog] }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/**
 * Trả thưởng khi cuộc đua đã có kết quả (gọi định kỳ, và khi mở game: cược từ lần trước vẫn được tính).
 * Trả về số vàng thắng (0 nếu thua), hoặc null nếu chưa tới lúc / không có cược.
 */
export function settleBet(state: GameState, now = Date.now()): number | null {
  const bet = state.race
  if (!bet || bet.paid) return null
  const race = raceById(bet.id, now)
  if (now < race.startAt + BET_MS + RUN_MS) return null
  bet.paid = true
  const won = race.winner === bet.dog ? Math.round(bet.amount * bet.odds) : 0
  state.player.gold += won
  bus.emit('notify', won
    ? { key: 'race.won', params: { dog: DOGS[bet.dog].name, gold: won }, good: true }
    : { key: 'race.lost', params: { dog: DOGS[race.winner].name, amount: bet.amount } })
  bus.emit('saveRequest', undefined)
  return won
}

function fail(key: string): false {
  bus.emit('notify', { key })
  return false
}
