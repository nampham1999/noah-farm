import { natural, newDeck, shuffle, suitOf, type Card } from './cards.ts'
import type { Engine, Round, Seat } from './engine.ts'

/**
 * Mậu binh (xập xám): mỗi người 13 lá, xếp thành 3 chi (3 lá, 5 lá, 5 lá) sao cho chi 1 ≤ chi 2 ≤ chi 3,
 * rồi so từng chi với từng người còn lại. Xếp sai thứ tự là "binh lủng" (thua cả ba chi).
 * Bài đặc biệt (sảnh rồng, ba thùng, ba sảnh, lục phé bôn) thắng thẳng khi tới trắng.
 */

export const ARRANGE_MS = 60_000
/** Số điểm tối đa giữa hai người trong một ván. */
const PAIR_CAP = 20
const SPECIAL_POINTS: Record<string, number> = { dragon: 20, threeFlush: 12, threeStraight: 12, sixPairs: 8 }
const SPECIAL_ORDER = ['sixPairs', 'threeStraight', 'threeFlush', 'dragon']

export interface Eval {
  cat: number
  key: number[]
}

/** Hạng cao A=14. */
const high = (c: Card): number => {
  const n = natural(c)
  return n === 1 ? 14 : n
}

/** Chấm 3 hoặc 5 lá. cat: 8 thùng phá sảnh, 7 tứ quý, 6 cù lũ, 5 thùng, 4 sảnh, 3 xám, 2 thú, 1 đôi, 0 mậu thầu. */
export function evalHand(cards: Card[]): Eval {
  const vals = cards.map(high).sort((a, b) => b - a)
  const groups = new Map<number, number>()
  for (const v of vals) groups.set(v, (groups.get(v) ?? 0) + 1)
  const g = [...groups.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const counts = g.map((x) => x[1])
  const order = g.map((x) => x[0])
  if (cards.length === 5) {
    const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]))
    let straightHigh = 0
    if (groups.size === 5) {
      if (vals[0] - vals[4] === 4) straightHigh = vals[0]
      else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5
    }
    if (straightHigh && flush) return { cat: 8, key: [8, straightHigh] }
    if (counts[0] === 4) return { cat: 7, key: [7, ...order] }
    if (counts[0] === 3 && counts[1] === 2) return { cat: 6, key: [6, ...order] }
    if (flush) return { cat: 5, key: [5, ...vals] }
    if (straightHigh) return { cat: 4, key: [4, straightHigh] }
  }
  if (counts[0] === 3) return { cat: 3, key: [3, ...order] }
  if (counts[0] === 2 && counts[1] === 2) return { cat: 2, key: [2, ...order] }
  if (counts[0] === 2) return { cat: 1, key: [1, ...order] }
  return { cat: 0, key: [0, ...vals] }
}

export function compareEval(a: Eval, b: Eval): number {
  const n = Math.max(a.key.length, b.key.length)
  for (let i = 0; i < n; i++) {
    const d = (a.key[i] ?? 0) - (b.key[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Thưởng thêm của chi thắng (ngoài 1 điểm mỗi chi): xám chi 1, cù lũ/tứ quý/TPS chi 2, tứ quý/TPS chi 3. */
function chiBonus(chi: number, e: Eval): number {
  if (chi === 0) return e.cat === 3 ? 2 : 0
  if (chi === 1) return e.cat === 6 ? 1 : e.cat === 7 ? 7 : e.cat === 8 ? 9 : 0
  return e.cat === 7 ? 3 : e.cat === 8 ? 4 : 0
}

export type Arrangement = [Card[], Card[], Card[]]

export function isValidOrder(arr: Arrangement): boolean {
  const [a, b, c] = arr.map(evalHand)
  return compareEval(a, b) <= 0 && compareEval(b, c) <= 0
}

function combos<T>(items: T[], k: number): T[][] {
  const out: T[][] = []
  const pick = (start: number, cur: T[]) => {
    if (cur.length === k) return void out.push(cur.slice())
    for (let i = start; i < items.length; i++) {
      cur.push(items[i])
      pick(i + 1, cur)
      cur.pop()
    }
  }
  pick(0, [])
  return out
}

/** Xếp tự động: chi 3 mạnh nhất có thể, rồi chi 2, miễn là đúng thứ tự (chi 1 ≤ chi 2 ≤ chi 3). */
export function autoArrange(hand: Card[]): Arrangement {
  let best: { arr: Arrangement; score: Eval[] } | null = null
  for (const c3 of combos(hand, 5)) {
    const e3 = evalHand(c3)
    if (best && compareEval(e3, best.score[2]) < 0) continue
    const rest = hand.filter((c) => !c3.includes(c))
    for (const c2 of combos(rest, 5)) {
      const e2 = evalHand(c2)
      if (compareEval(e2, e3) > 0) continue
      const c1 = rest.filter((c) => !c2.includes(c))
      const e1 = evalHand(c1)
      if (compareEval(e1, e2) > 0) continue
      const score = [e1, e2, e3]
      if (!best || compareEval(e3, best.score[2]) > 0 || (compareEval(e3, best.score[2]) === 0 && (compareEval(e2, best.score[1]) > 0 || (compareEval(e2, best.score[1]) === 0 && compareEval(e1, best.score[0]) > 0)))) {
        best = { arr: [c1, c2, c3], score }
      }
    }
  }
  // Luôn có cách xếp đúng thứ tự (chi 3 và chi 2 là hai bộ tốt nhất nên chi 1 không thể hơn); dự phòng cho chắc.
  return best?.arr ?? [hand.slice(0, 3), hand.slice(3, 8), hand.slice(8, 13)]
}

/** Bài tới trắng của 13 lá, hoặc null. */
export function specialOf(hand: Card[]): string | null {
  const nats = hand.map(natural)
  if (new Set(nats).size === 13) return 'dragon'
  // Ba thùng: chia thành 3 + 5 + 5, mỗi nhóm cùng chất.
  const suits = [0, 0, 0, 0]
  for (const c of hand) suits[suitOf(c)]++
  const sizes = [3, 5, 5]
  for (let m = 0; m < 64; m++) {
    const assign = [m & 3, (m >> 2) & 3, (m >> 4) & 3]
    const sum = [0, 0, 0, 0]
    assign.forEach((s, i) => (sum[s] += sizes[i]))
    if (sum.every((v, s) => v === suits[s])) return 'threeFlush'
  }
  if (threeStraights(hand)) return 'threeStraight'
  const counts = new Map<number, number>()
  for (const n of nats) counts.set(n, (counts.get(n) ?? 0) + 1)
  if ([...counts.values()].reduce((a, v) => a + Math.floor(v / 2), 0) >= 6) return 'sixPairs'
  return null
}

function threeStraights(hand: Card[]): boolean {
  const aces = hand.filter((c) => natural(c) === 1).length
  for (let low = 0; low <= aces; low++) {
    const cnt = new Array<number>(16).fill(0)
    for (const c of hand) {
      const n = natural(c)
      if (n !== 1) cnt[n]++
    }
    cnt[1] = low
    cnt[14] = aces - low
    if (takeRuns(cnt, [3, 5, 5])) return true
  }
  return false
}

function takeRuns(cnt: number[], sizes: number[]): boolean {
  let start = 1
  while (start <= 14 && cnt[start] === 0) start++
  if (start > 14) return sizes.length === 0
  for (let i = 0; i < sizes.length; i++) {
    if (i > 0 && sizes[i] === sizes[i - 1]) continue
    const len = sizes[i]
    if (start + len - 1 > 14) continue
    let ok = true
    for (let r = start; r < start + len; r++) if (cnt[r] === 0) ok = false
    if (!ok) continue
    for (let r = start; r < start + len; r++) cnt[r]--
    const rest = sizes.filter((_, j) => j !== i)
    const found = takeRuns(cnt, rest)
    for (let r = start; r < start + len; r++) cnt[r]++
    if (found) return true
  }
  return false
}

interface Reveal {
  chi: Card[][]
  special: string | null
  lung: boolean
}

/** Điểm của a so với b (dương: a thắng), đã giới hạn PAIR_CAP. */
export function pairPoints(a: Reveal, b: Reveal): number {
  let pts: number
  if (a.special || b.special) {
    const sa = a.special ? SPECIAL_ORDER.indexOf(a.special) : -1
    const sb = b.special ? SPECIAL_ORDER.indexOf(b.special) : -1
    pts = sa === sb ? 0 : sa > sb ? SPECIAL_POINTS[a.special!] : -SPECIAL_POINTS[b.special!]
  } else if (a.lung || b.lung) {
    if (a.lung && b.lung) return 0
    const w = a.lung ? b : a
    pts = w.chi.reduce((sum, c, i) => sum + 1 + chiBonus(i, evalHand(c)), 0) * (a.lung ? -1 : 1)
  } else {
    let total = 0
    let wins = 0
    let losses = 0
    for (let i = 0; i < 3; i++) {
      const ea = evalHand(a.chi[i])
      const eb = evalHand(b.chi[i])
      const d = compareEval(ea, eb)
      if (d > 0) {
        total += 1 + chiBonus(i, ea)
        wins++
      } else if (d < 0) {
        total -= 1 + chiBonus(i, eb)
        losses++
      }
    }
    // Thắng cả ba chi (sập hầm) thì nhân đôi.
    if (wins === 3 || losses === 3) total *= 2
    pts = total
  }
  return Math.max(-PAIR_CAP, Math.min(PAIR_CAP, pts))
}

function finalize(round: Round, seats: string[]): void {
  const arr = (round.secret!.arr ?? {}) as Record<string, Arrangement>
  const reveal: Record<string, Reveal> = {}
  for (const uid of seats) {
    const a = arr[uid]
    const special = specialOf(round.hands[uid])
    reveal[uid] = { chi: a, special, lung: !special && !isValidOrder(a) }
  }
  const points: Record<string, number> = Object.fromEntries(seats.map((u) => [u, 0]))
  for (const u of seats) for (const v of seats) if (u !== v) points[u] += pairPoints(reveal[u], reveal[v])
  round.pub.phase = 'result'
  round.pub.reveal = reveal
  round.pub.points = points
}

export const mauBinh: Engine = {
  id: 'mauBinh',
  min: 2,
  max: 4,
  maxLoss: (stake, players) => stake * PAIR_CAP * (players - 1),
  deal(seats: Seat[], rand, now) {
    const deck = shuffle(newDeck(), rand)
    const hands: Record<string, Card[]> = {}
    seats.forEach((s, i) => (hands[s.uid] = deck.slice(i * 13, i * 13 + 13)))
    return {
      pub: { game: 'mauBinh', phase: 'arrange', deadline: now + ARRANGE_MS, order: seats.map((s) => s.uid), submitted: [] },
      hands,
      secret: { arr: {} },
    }
  },
  move(round, uid, move, now) {
    if (round.pub.phase !== 'arrange') return 'closed'
    const m = move as { type?: string; chi?: Card[][] }
    const order = round.pub.order as string[]
    const submitted = round.pub.submitted as string[]
    if (!order.includes(uid) || m.type !== 'submit' || !Array.isArray(m.chi) || m.chi.length !== 3) return 'bad'
    if (submitted.includes(uid)) return 'done'
    const sizes = [3, 5, 5]
    const flat = m.chi.flat()
    const hand = round.hands[uid]
    if (m.chi.some((c, i) => !Array.isArray(c) || c.length !== sizes[i]) || flat.length !== 13 || new Set(flat).size !== 13 || flat.some((c) => !hand.includes(c))) return 'bad'
    ;(round.secret!.arr as Record<string, Arrangement>)[uid] = m.chi as Arrangement
    submitted.push(uid)
    if (submitted.length === order.length) finalize(round, order)
    void now
    return null
  },
  tick(round, now) {
    if (round.pub.phase !== 'arrange' || now <= (round.pub.deadline as number)) return false
    const order = round.pub.order as string[]
    const arr = round.secret!.arr as Record<string, Arrangement>
    for (const uid of order) {
      if (!arr[uid]) {
        arr[uid] = autoArrange(round.hands[uid])
        ;(round.pub.submitted as string[]).push(uid)
      }
    }
    finalize(round, order)
    return true
  },
  result(round, stake) {
    if (round.pub.phase !== 'result') return null
    const pts = round.pub.points as Record<string, number>
    return Object.fromEntries(Object.entries(pts).map(([u, p]) => [u, p * stake]))
  },
}
