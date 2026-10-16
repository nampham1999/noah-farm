import { newDeck, rankOf, shuffle, type Card } from './cards.ts'
import type { Engine, Round, Seat } from './engine.ts'

/**
 * Tiến lên miền Nam: 2–4 người, mỗi người 13 lá, ai hết bài trước thắng.
 * Thứ tự lá: 3 < 4 < … < K < A < 2; cùng hạng thì ♠ < ♣ < ♦ < ♥ (đúng thứ tự mã lá bài).
 * Bộ bài: lẻ, đôi, sám, tứ quý, sảnh (≥3 lá, không có 2), đôi thông (≥3 đôi liền nhau, không có 2).
 * Chặt: tứ quý và đôi thông chặt được heo (lá 2). Người bị chặt heo mất thêm tiền.
 */

export const TURN_MS = 30_000
const HEO_RANK = 12
/** Thua tối đa: cháy (13 lá × 2) cộng tiền bị chặt heo. */
const MAX_LOSS_UNITS = 34

export type Kind = 'single' | 'pair' | 'triple' | 'quad' | 'seq' | 'pairseq'
export interface Combo {
  kind: Kind
  /** Số lá (sảnh), số đôi (đôi thông), hoặc số lá của bộ cùng hạng. */
  len: number
  /** Lá lớn nhất của bộ (theo mã lá bài). */
  top: number
}

/** Nhận dạng một bộ bài hợp lệ, hoặc null. */
export function classify(cards: Card[]): Combo | null {
  const n = cards.length
  if (n === 0 || new Set(cards).size !== n) return null
  const sorted = cards.slice().sort((a, b) => a - b)
  const ranks = sorted.map(rankOf)
  const top = sorted[n - 1]
  if (ranks.every((r) => r === ranks[0])) {
    if (n === 1) return { kind: 'single', len: 1, top }
    if (n === 2) return { kind: 'pair', len: 2, top }
    if (n === 3) return { kind: 'triple', len: 3, top }
    if (n === 4) return { kind: 'quad', len: 4, top }
    return null
  }
  if (ranks.some((r) => r === HEO_RANK)) return null
  if (n >= 3 && new Set(ranks).size === n && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) return { kind: 'seq', len: n, top }
  if (n >= 6 && n % 2 === 0) {
    const pairs = ranks.filter((_, i) => i % 2 === 0)
    if (ranks.every((r, i) => r === pairs[i >> 1]) && pairs.every((r, i) => i === 0 || r === pairs[i - 1] + 1)) return { kind: 'pairseq', len: n / 2, top }
  }
  return null
}

/** Bộ mới có chặt được bộ trước không (đánh cùng loại lớn hơn, hoặc chặt heo / chặt bộ chặt). */
export function beats(prev: Combo, next: Combo): boolean {
  if (next.kind === prev.kind && next.len === prev.len) return next.top > prev.top
  const prevHeo = (prev.kind === 'single' || prev.kind === 'pair') && rankOf(prev.top) === HEO_RANK
  if (prevHeo) {
    if (prev.kind === 'single') return next.kind === 'quad' || next.kind === 'pairseq'
    return next.kind === 'quad' || (next.kind === 'pairseq' && next.len >= 4)
  }
  if (prev.kind === 'pairseq' && prev.len === 3) return next.kind === 'quad' || (next.kind === 'pairseq' && next.len >= 4)
  if (prev.kind === 'quad') return next.kind === 'pairseq' && next.len >= 4
  return false
}

/** Số đơn vị tiền người bị chặt heo mất: heo lẻ 2, đôi heo 4. */
function chopPenalty(prev: Combo, next: Combo): number {
  const bomb = next.kind === 'quad' || next.kind === 'pairseq'
  if (!bomb || rankOf(prev.top) !== HEO_RANK) return 0
  return prev.kind === 'single' ? 2 : prev.kind === 'pair' ? 4 : 0
}

/** Mọi cách đánh hợp lệ từ tay bài (khi last = null thì mọi bộ, không thì chỉ bộ chặt được). Dùng cho gợi ý, tự đánh, test. */
export function findPlays(hand: Card[], last: Combo | null, must?: Card): Card[][] {
  const byRank: Card[][] = Array.from({ length: 13 }, () => [])
  for (const c of hand.slice().sort((a, b) => a - b)) byRank[rankOf(c)].push(c)
  const out: Card[][] = []
  const push = (cards: Card[]) => {
    const combo = classify(cards)
    if (!combo) return
    if (must !== undefined && !cards.includes(must)) return
    if (last && !beats(last, combo)) return
    out.push(cards)
  }
  const pickK = (cards: Card[], k: number): Card[][] => {
    const res: Card[][] = []
    const rec = (s: number, cur: Card[]) => {
      if (cur.length === k) return void res.push(cur.slice())
      for (let i = s; i < cards.length; i++) {
        cur.push(cards[i])
        rec(i + 1, cur)
        cur.pop()
      }
    }
    rec(0, [])
    return res
  }
  for (const group of byRank) {
    for (let k = 1; k <= group.length; k++) for (const c of pickK(group, k)) push(c)
  }
  // Sảnh: chọn một lá cho mỗi hạng liên tiếp (tối đa 4^12 là quá nhiều, nhưng tay chỉ 13 lá nên số tổ hợp nhỏ).
  for (let start = 0; start <= 10; start++) {
    let combos: Card[][] = [[]]
    for (let r = start; r <= 11; r++) {
      if (!byRank[r].length) break
      combos = combos.flatMap((c) => byRank[r].map((x) => [...c, x]))
      if (r - start + 1 >= 3) combos.forEach(push)
      if (combos.length > 4000) break
    }
  }
  // Đôi thông.
  for (let start = 0; start <= 9; start++) {
    let combos: Card[][] = [[]]
    for (let r = start; r <= 11; r++) {
      if (byRank[r].length < 2) break
      const pairs = pickK(byRank[r], 2)
      combos = combos.flatMap((c) => pairs.map((p) => [...c, ...p]))
      if (r - start + 1 >= 3) combos.forEach(push)
      if (combos.length > 4000) break
    }
  }
  return out
}

interface Last {
  uid: string
  cards: Card[]
}

export const tienLen: Engine = {
  id: 'tienLen',
  min: 2,
  max: 4,
  maxLoss: (stake) => stake * MAX_LOSS_UNITS,
  deal(seats: Seat[], rand, now) {
    const deck = shuffle(newDeck(), rand)
    const hands: Record<string, Card[]> = {}
    seats.forEach((s, i) => (hands[s.uid] = deck.slice(i * 13, i * 13 + 13).sort((a, b) => a - b)))
    // Người giữ lá nhỏ nhất đi trước và phải đánh kèm lá đó.
    let starter = seats[0].uid
    let must = hands[starter][0]
    for (const s of seats) if (hands[s.uid][0] < must) [starter, must] = [s.uid, hands[s.uid][0]]
    return {
      pub: {
        game: 'tienLen',
        phase: 'play',
        ms: TURN_MS,
        order: seats.map((s) => s.uid),
        turn: starter,
        deadline: now + TURN_MS,
        last: null,
        passed: [],
        counts: Object.fromEntries(seats.map((s) => [s.uid, 13])),
        must,
        chop: Object.fromEntries(seats.map((s) => [s.uid, 0])),
        winner: null,
      },
      hands,
    }
  },
  move(round, uid, move, now) {
    const p = round.pub
    if (p.phase !== 'play') return 'closed'
    if (p.turn !== uid) return 'turn'
    const m = move as { type?: string; cards?: Card[] }
    const last = p.last as Last | null
    const passed = p.passed as string[]
    const order = p.order as string[]
    if (m.type === 'pass') {
      if (!last) return 'lead'
      passed.push(uid)
    } else if (m.type === 'play' && Array.isArray(m.cards)) {
      const hand = round.hands[uid]
      if (m.cards.some((c) => !hand.includes(c))) return 'bad'
      const combo = classify(m.cards)
      if (!combo) return 'bad'
      if (p.must !== null && !m.cards.includes(p.must as number)) return 'must'
      if (last) {
        const prevCombo = classify(last.cards)!
        if (!beats(prevCombo, combo)) return 'weak'
        const pen = chopPenalty(prevCombo, combo)
        if (pen) {
          const chop = p.chop as Record<string, number>
          chop[uid] += pen
          chop[last.uid] -= pen
        }
      }
      round.hands[uid] = hand.filter((c) => !m.cards!.includes(c))
      ;(p.counts as Record<string, number>)[uid] = round.hands[uid].length
      p.last = { uid, cards: m.cards.slice().sort((a, b) => a - b) }
      p.passed = []
      p.must = null
      if (round.hands[uid].length === 0) {
        p.phase = 'result'
        p.winner = uid
        p.deadline = 0
        return null
      }
    } else return 'bad'
    // Người kế tiếp: bỏ qua người đã bỏ lượt; vòng về người đánh cuối thì mở vòng mới cho họ.
    const cur = order.indexOf(uid)
    const lead = (p.last as Last).uid
    const passedNow = p.passed as string[]
    for (let i = 1; i <= order.length; i++) {
      const u = order[(cur + i) % order.length]
      if (u === lead) {
        p.turn = u
        p.last = null
        p.passed = []
        break
      }
      if (!passedNow.includes(u)) {
        p.turn = u
        break
      }
    }
    p.deadline = now + TURN_MS
    return null
  },
  tick(round, now) {
    const p = round.pub
    if (p.phase !== 'play' || now <= (p.deadline as number)) return false
    const uid = p.turn as string
    const last = p.last as Last | null
    if (last) return this.move(round, uid, { type: 'pass' }, now) === null
    // Phải mở vòng: đánh lá nhỏ nhất (kèm lá bắt buộc ở nước đầu).
    const hand = round.hands[uid]
    const card = p.must !== null ? (p.must as number) : hand[0]
    return this.move(round, uid, { type: 'play', cards: [card] }, now) === null
  },
  result(round, stake) {
    const p = round.pub
    if (p.phase !== 'result') return null
    const winner = p.winner as string
    const counts = p.counts as Record<string, number>
    const chop = p.chop as Record<string, number>
    const units: Record<string, number> = { ...chop }
    for (const [uid, left] of Object.entries(counts)) {
      if (uid === winner) continue
      const pay = left === 13 ? 26 : left
      units[uid] -= pay
      units[winner] += pay
    }
    return Object.fromEntries(Object.entries(units).map(([u, v]) => [u, v * stake]))
  },
}

export type { Round }
