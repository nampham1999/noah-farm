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
  // Về đích: chó thắng sớm nhất; đôi khi chó về nhì sát nút (phân định bằng ảnh), còn lại cách xa dần.
  const photo = rand() < 0.35
  // Xáo Fisher-Yates (sort với hàm so sánh ngẫu nhiên cho kết quả khác nhau giữa các trình duyệt).
  const order = DOGS.map((_, i) => i).filter((i) => i !== winner)
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1))
    ;[order[k], order[j]] = [order[j], order[k]]
  }
  const finish = DOGS.map(() => 0)
  finish[winner] = 0.84
  let gap = photo ? 0.004 + rand() * 0.008 : 0.015 + rand() * 0.03
  for (const i of order) {
    finish[i] = Math.min(0.99, finish[winner] + gap)
    gap += 0.01 + rand() * 0.035
  }
  const startAt = id * RACE_PERIOD_MS
  const t = now - startAt
  const phase: RacePhase = t < BET_MS ? 'betting' : t < BET_MS + RUN_MS ? 'running' : 'results'
  const left = phase === 'betting' ? BET_MS - t : phase === 'running' ? BET_MS + RUN_MS - t : RACE_PERIOD_MS - t
  return { id, phase, startAt, left, odds, winner, finish }
}

const SAMPLES = 160
const curves = new Map<string, Float32Array>()

/**
 * Đường chạy của chó i: tốc độ dao động theo vài nhịp (bứt tốc, hụt hơi) có hạt giống riêng,
 * cộng dồn lại rồi chuẩn hoá để về đích đúng lúc finish[i]. Nhờ vậy dẫn đầu đổi chỗ liên tục
 * mà kết quả vẫn đúng như đã định, và mọi máy vẽ ra giống hệt nhau.
 */
function curve(race: Race, i: number): Float32Array {
  const key = `${race.id}:${i}`
  let c = curves.get(key)
  if (c) return c
  const rand = mulberry32((race.id * 31 + i * 7919) | 0)
  const waves = [0, 1, 2].map((k) => ({
    a: (k === 0 ? 0.3 : 0.18) + rand() * (k === 0 ? 0.25 : 0.15),
    f: (k === 0 ? 0.6 : 1.6 + k) + rand() * 1.2,
    p: rand() * Math.PI * 2,
  }))
  c = new Float32Array(SAMPLES + 1)
  let sum = 0
  for (let k = 1; k <= SAMPLES; k++) {
    const tau = k / SAMPLES
    // Xuất phát: tăng tốc trong 10% đầu.
    const start = Math.min(1, tau / 0.1)
    let speed = 1
    for (const w of waves) speed += w.a * Math.sin(2 * Math.PI * w.f * tau + w.p)
    sum += Math.max(0.15, speed) * start
    c[k] = sum
  }
  for (let k = 0; k <= SAMPLES; k++) c[k] /= sum
  if (curves.size > 60) curves.clear()
  curves.set(key, c)
  return c
}

/** Quãng đường (0..1) của chó i ở thời điểm u (0..1 của RUN_MS). */
export function dogProgress(race: Race, i: number, u: number): number {
  const tau = Math.min(1, Math.max(0, u / race.finish[i]))
  const c = curve(race, i)
  const x = tau * SAMPLES
  const k = Math.floor(x)
  return k >= SAMPLES ? 1 : c[k] + (c[k + 1] - c[k]) * (x - k)
}

/** Thứ tự hiện tại (chỉ số chó, dẫn đầu trước); khi đã về đích thì xếp theo lúc về. */
export function standings(race: Race, u: number): number[] {
  return DOGS.map((_, i) => i).sort((a, b) => {
    const pa = dogProgress(race, a, u)
    const pb = dogProgress(race, b, u)
    if (pa >= 1 && pb >= 1) return race.finish[a] - race.finish[b]
    return pb - pa
  })
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
