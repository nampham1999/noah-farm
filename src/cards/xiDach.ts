import { natural, newDeck, shuffle, type Card } from './cards.ts'
import type { Engine, Seat } from './engine.ts'

/**
 * Xì dách: người đầu bàn (chủ bàn) là nhà cái, những người còn lại đấu với nhà cái.
 * Mỗi người nhận 2 lá, rút thêm tới tối đa 5 lá. Gần 21 nhất thắng, quá 21 là quắc.
 * Xì bàng (hai Át) > ngũ linh (5 lá không quá 21) > xì dách (Át + lá 10 điểm) > điểm thường.
 * Con phải đủ 16 điểm mới được dằn, nhà cái phải đủ 15.
 */

export const TURN_MS = 25_000
export const PLAYER_MIN = 16
export const DEALER_MIN = 15
const MAX_CARDS = 5

/** Điểm tốt nhất không quá 21 (Át tính 1, 10 hoặc 11); nếu quá thì trả về tổng nhỏ nhất. */
export function bestTotal(cards: Card[]): number {
  let base = 0
  let aces = 0
  for (const c of cards) {
    const n = natural(c)
    if (n === 1) aces++
    else base += n >= 10 ? 10 : n
  }
  let best = -1
  const walk = (i: number, sum: number) => {
    if (i === aces) {
      if (sum <= 21 && sum > best) best = sum
      return
    }
    for (const v of [1, 10, 11]) walk(i + 1, sum + v)
  }
  walk(0, base)
  return best >= 0 ? best : base + aces
}

export interface HandClass {
  /** 5 xì bàng, 4 ngũ linh, 3 xì dách, 2 điểm thường, 0 quắc. */
  cls: number
  points: number
}

export function classOf(cards: Card[]): HandClass {
  const points = bestTotal(cards)
  if (cards.length === 2) {
    const nats = cards.map(natural)
    if (nats[0] === 1 && nats[1] === 1) return { cls: 5, points: 22 }
    if (nats.includes(1) && nats.some((n) => n >= 10)) return { cls: 3, points: 21 }
  }
  if (points > 21) return { cls: 0, points }
  if (cards.length === MAX_CARDS) return { cls: 4, points }
  return { cls: 2, points }
}

const UNITS: Record<number, number> = { 5: 3, 4: 2, 3: 2, 2: 1, 0: 1 }

/** Điểm (đơn vị cược) con thắng nhà cái: dương là con thắng. */
export function settleOne(player: HandClass, dealer: HandClass): number {
  if (player.cls === 0 && dealer.cls === 0) return -UNITS[0]
  if (player.cls > dealer.cls) return UNITS[player.cls]
  if (player.cls < dealer.cls) return -UNITS[dealer.cls]
  if (player.cls === 2) return player.points > dealer.points ? 1 : player.points < dealer.points ? -1 : 0
  return 0
}

const isSpecial = (cards: Card[]): boolean => classOf(cards).cls >= 3

function finish(round: { pub: Record<string, unknown>; hands: Record<string, Card[]> }): void {
  const p = round.pub
  const order = p.order as string[]
  const dealer = order[0]
  const dc = classOf(round.hands[dealer])
  const units: Record<string, number> = { [dealer]: 0 }
  for (const uid of order.slice(1)) {
    const u = settleOne(classOf(round.hands[uid]), dc)
    units[uid] = u
    units[dealer] -= u
  }
  p.phase = 'result'
  p.deadline = 0
  p.units = units
  p.reveal = Object.fromEntries(order.map((u) => [u, round.hands[u]]))
}

function advance(round: { pub: Record<string, unknown>; hands: Record<string, Card[]> }, now: number): void {
  const p = round.pub
  const order = p.order as string[]
  const done = p.done as string[]
  // Lượt: các con theo thứ tự, nhà cái cuối cùng.
  const seq = [...order.slice(1), order[0]]
  const next = seq.find((u) => !done.includes(u))
  if (!next) return finish(round)
  p.turn = next
  p.deadline = now + TURN_MS
}

export const xiDach: Engine = {
  id: 'xiDach',
  min: 2,
  max: 5,
  maxLoss: (stake, players) => stake * 3 * (players - 1),
  deal(seats: Seat[], rand, now) {
    const deck = shuffle(newDeck(), rand)
    const hands: Record<string, Card[]> = {}
    seats.forEach((s, i) => (hands[s.uid] = [deck[i * 2], deck[i * 2 + 1]]))
    const round = {
      pub: {
        game: 'xiDach',
        phase: 'play',
        ms: TURN_MS,
        order: seats.map((s) => s.uid),
        turn: seats[0].uid,
        deadline: now + TURN_MS,
        counts: Object.fromEntries(seats.map((s) => [s.uid, 2])),
        done: [] as string[],
      },
      hands,
      secret: { deck: deck.slice(seats.length * 2) },
    }
    const dealer = seats[0].uid
    // Nhà cái có xì dách / xì bàng: lật bài ngay. Con có xì dách / xì bàng thì tự dằn.
    if (isSpecial(hands[dealer])) {
      round.pub.done = seats.map((s) => s.uid)
      finish(round)
      return round
    }
    for (const s of seats.slice(1)) if (isSpecial(hands[s.uid])) (round.pub.done as string[]).push(s.uid)
    advance(round, now)
    return round
  },
  move(round, uid, move, now) {
    const p = round.pub
    if (p.phase !== 'play') return 'closed'
    if (p.turn !== uid) return 'turn'
    const m = move as { type?: string }
    const hand = round.hands[uid]
    const done = p.done as string[]
    const min = uid === (p.order as string[])[0] ? DEALER_MIN : PLAYER_MIN
    if (m.type === 'stand') {
      if (hand.length < MAX_CARDS && bestTotal(hand) < min) return 'low'
      done.push(uid)
    } else if (m.type === 'hit') {
      if (hand.length >= MAX_CARDS) return 'full'
      const deck = round.secret!.deck as Card[]
      hand.push(deck.pop()!)
      ;(p.counts as Record<string, number>)[uid] = hand.length
      const c = classOf(hand)
      // Quắc, đủ 5 lá, hoặc đã 21 điểm thì tự dằn.
      if (c.cls === 0 || hand.length === MAX_CARDS || c.points === 21) done.push(uid)
    } else return 'bad'
    advance(round, now)
    return null
  },
  tick(round, now) {
    const p = round.pub
    if (p.phase !== 'play' || now <= (p.deadline as number)) return false
    const uid = p.turn as string
    const min = uid === (p.order as string[])[0] ? DEALER_MIN : PLAYER_MIN
    const hand = round.hands[uid]
    const standOk = hand.length >= MAX_CARDS || bestTotal(hand) >= min
    return this.move(round, uid, { type: standOk ? 'stand' : 'hit' }, now) === null
  },
  result(round, stake) {
    const p = round.pub
    if (p.phase !== 'result') return null
    return Object.fromEntries(Object.entries(p.units as Record<string, number>).map(([u, v]) => [u, v * stake]))
  },
}
