import { natural, newDeck, shuffle, suitOf, type Card } from './cards.ts'
import type { Engine, Round, Seat } from './engine.ts'

/**
 * Phỏm (tá lả): 2–4 người, mỗi người 9 lá (người đi đầu 10 lá). Mỗi lượt: bốc một lá, hoặc ăn lá người
 * trước vừa đánh nếu tạo được phỏm (3 lá cùng hạng, hoặc 3 lá liền cùng chất trở lên); rồi đánh ra một lá.
 * Mỗi người đánh 4 lá thì ván kết thúc: ai còn ít điểm "rác" nhất (lá ngoài phỏm) thắng.
 * Ù: có 10 lá toàn phỏm thì thắng ngay và ăn đậm. Phỏm của mỗi người được máy tự xếp sao cho rác ít nhất.
 */

export const TURN_MS = 30_000
const DISCARDS = 4
/** Mức thắng khi ù: mỗi đối thủ trả bấy nhiêu đơn vị. */
const WIN_UNITS = 5
const MAX_LOSS_UNITS = 5

const points = (c: Card): number => natural(c)

/** Mọi phỏm có thể tạo từ các lá này (bộ ≥3 cùng hạng, sảnh ≥3 cùng chất; Át chỉ là 1). */
export function allMelds(cards: Card[]): Card[][] {
  const out: Card[][] = []
  const byNat = new Map<number, Card[]>()
  for (const c of cards) byNat.set(natural(c), [...(byNat.get(natural(c)) ?? []), c])
  for (const group of byNat.values()) {
    if (group.length >= 3) {
      for (let i = 0; i < group.length; i++) out.push(group.filter((_, j) => j !== i))
      out.push(group.slice())
    }
  }
  for (let s = 0; s < 4; s++) {
    const suited = cards.filter((c) => suitOf(c) === s).sort((a, b) => natural(a) - natural(b))
    for (let i = 0; i < suited.length; i++) {
      const run = [suited[i]]
      for (let j = i + 1; j < suited.length; j++) {
        if (natural(suited[j]) !== natural(run[run.length - 1]) + 1) break
        run.push(suited[j])
        if (run.length >= 3) out.push(run.slice())
      }
    }
  }
  return out
}

export interface Arrangement {
  melds: Card[][]
  rest: Card[]
  points: number
}

/** Cách xếp phỏm cho ít điểm rác nhất. */
export function bestArrangement(hand: Card[]): Arrangement {
  const melds = allMelds(hand)
  let best: Arrangement = { melds: [], rest: hand.slice(), points: hand.reduce((a, c) => a + points(c), 0) }
  const used = new Set<Card>()
  const chosen: Card[][] = []
  const rec = (start: number, rest: number) => {
    if (rest < best.points) {
      best = { melds: chosen.map((m) => m.slice()), rest: hand.filter((c) => !used.has(c)), points: rest }
    }
    for (let i = start; i < melds.length; i++) {
      const m = melds[i]
      if (m.some((c) => used.has(c))) continue
      m.forEach((c) => used.add(c))
      chosen.push(m)
      rec(i + 1, rest - m.reduce((a, c) => a + points(c), 0))
      chosen.pop()
      m.forEach((c) => used.delete(c))
    }
  }
  rec(0, best.points)
  return best
}

/** Lá này ăn được không: có phỏm gồm lá đó cùng các lá trên tay. */
export function canEat(hand: Card[], card: Card): boolean {
  return allMelds([...hand, card]).some((m) => m.includes(card))
}

const isWinHand = (hand: Card[]): boolean => hand.length >= 10 && bestArrangement(hand).points === 0

interface Pub {
  order: string[]
  turn: string
  stage: 'draw' | 'discard'
  discards: Record<string, Card[]>
  eaten: Record<string, Card[]>
  done: Record<string, number>
  last: { uid: string; card: Card } | null
}

function finish(round: Round, win: string | null): void {
  const p = round.pub as unknown as Pub & Record<string, unknown>
  const order = p.order
  const arr = Object.fromEntries(order.map((u) => [u, bestArrangement(round.hands[u])]))
  const units: Record<string, number> = Object.fromEntries(order.map((u) => [u, 0]))
  if (win) {
    for (const u of order) if (u !== win) {
      units[u] = -WIN_UNITS
      units[win] += WIN_UNITS
    }
  } else {
    const ranked = order.slice().sort((a, b) => arr[a].points - arr[b].points || order.indexOf(a) - order.indexOf(b))
    const n = ranked.length
    // Hạng k nhận (n-1-2k) đơn vị: 2 người ±1, 3 người +2,0,-2, 4 người +3,+1,-1,-3.
    ranked.forEach((u, k) => (units[u] = n - 1 - 2 * k))
  }
  p.phase = 'result'
  p.deadline = 0
  p.winner = win
  p.reveal = Object.fromEntries(order.map((u) => [u, { hand: round.hands[u], melds: arr[u].melds, points: arr[u].points }]))
  p.units = units
}

export const phom: Engine = {
  id: 'phom',
  min: 2,
  max: 4,
  maxLoss: (stake) => stake * MAX_LOSS_UNITS,
  deal(seats: Seat[], rand, now) {
    const deck = shuffle(newDeck(), rand)
    const hands: Record<string, Card[]> = {}
    let at = 0
    seats.forEach((s, i) => {
      const n = i === 0 ? 10 : 9
      hands[s.uid] = deck.slice(at, at + n).sort((a, b) => a - b)
      at += n
    })
    const order = seats.map((s) => s.uid)
    const round: Round = {
      pub: {
        game: 'phom',
        phase: 'play',
        ms: TURN_MS,
        order,
        turn: order[0],
        stage: 'discard',
        deadline: now + TURN_MS,
        discards: Object.fromEntries(order.map((u) => [u, []])),
        eaten: Object.fromEntries(order.map((u) => [u, []])),
        done: Object.fromEntries(order.map((u) => [u, 0])),
        last: null,
        deckCount: deck.length - at,
        winner: null,
      },
      hands,
      secret: { deck: deck.slice(at) },
    }
    if (isWinHand(hands[order[0]])) finish(round, order[0])
    return round
  },
  move(round, uid, move, now) {
    const p = round.pub as unknown as Pub & Record<string, unknown>
    if (p.phase !== 'play') return 'closed'
    if (p.turn !== uid) return 'turn'
    const m = move as { type?: string; card?: Card }
    const hand = round.hands[uid]
    const deck = round.secret!.deck as Card[]
    if (p.stage === 'draw') {
      if (m.type === 'draw') {
        if (!deck.length) return 'empty'
        hand.push(deck.pop()!)
        p.deckCount = deck.length
      } else if (m.type === 'eat') {
        const last = p.last
        if (!last || last.uid === uid || !canEat(hand, last.card)) return 'noEat'
        hand.push(last.card)
        p.eaten[uid].push(last.card)
        const pile = p.discards[last.uid]
        pile.splice(pile.lastIndexOf(last.card), 1)
        p.last = null
      } else return 'bad'
      hand.sort((a, b) => a - b)
      p.stage = 'discard'
      p.deadline = now + TURN_MS
      if (isWinHand(hand)) finish(round, uid)
      return null
    }
    // Đánh một lá (không được đánh lá đã ăn).
    if (m.type !== 'discard' || typeof m.card !== 'number' || !hand.includes(m.card)) return 'bad'
    if (p.eaten[uid].includes(m.card)) return 'eaten'
    round.hands[uid] = hand.filter((c) => c !== m.card)
    p.discards[uid].push(m.card)
    p.last = { uid, card: m.card }
    p.done[uid]++
    if (p.order.every((u) => p.done[u] >= DISCARDS)) {
      finish(round, null)
      return null
    }
    const next = p.order[(p.order.indexOf(uid) + 1) % p.order.length]
    p.turn = next
    p.stage = 'draw'
    p.deadline = now + TURN_MS
    return null
  },
  tick(round, now) {
    const p = round.pub as unknown as Pub & Record<string, unknown>
    if (p.phase !== 'play' || now <= (p.deadline as number)) return false
    const uid = p.turn
    if (p.stage === 'draw') return this.move(round, uid, { type: 'draw' }, now) === null
    const hand = round.hands[uid]
    const arr = bestArrangement(hand)
    const pool = (arr.rest.length ? arr.rest : hand).filter((c) => !p.eaten[uid].includes(c))
    const card = (pool.length ? pool : hand.filter((c) => !p.eaten[uid].includes(c))).sort((a, b) => points(b) - points(a))[0]
    return this.move(round, uid, { type: 'discard', card }, now) === null
  },
  result(round, stake) {
    const p = round.pub
    if (p.phase !== 'result') return null
    return Object.fromEntries(Object.entries(p.units as Record<string, number>).map(([u, v]) => [u, v * stake]))
  },
}
