import type { Card } from '../../cards/cards.ts'
import { bestArrangement, canEat } from '../../cards/phom.ts'
import { t } from '../../i18n/index.ts'
import { banner, cardEl } from './cardEl.ts'
import { cardText } from '../../cards/cards.ts'
import type { ViewCtx } from './table.ts'

interface Local {
  round: number
  selected: Card | null
}
let local: Local = { round: -1, selected: null }

interface Reveal {
  hand: Card[]
  melds: Card[][]
  points: number
}

/** Màn Phỏm: bốc hoặc ăn, rồi đánh một lá; hết 4 lượt thì hạ bài, ít rác nhất thắng. */
export function renderPhom(root: HTMLElement, ctx: ViewCtx): void {
  const s = ctx.session
  const pub = s.pub!
  if (local.round !== s.meta.round) local = { round: s.meta.round, selected: null }
  const name = (uid: string) => s.seats.find((x) => x.uid === uid)?.name ?? '?'
  const order = pub.order as string[]
  const turn = pub.turn as string
  const stage = pub.stage as string
  const discards = pub.discards as Record<string, Card[]>
  const eaten = pub.eaten as Record<string, Card[]>
  const done = pub.done as Record<string, number>
  const last = pub.last as { uid: string; card: Card } | null
  const over = pub.phase === 'result'

  if (over) {
    const reveal = pub.reveal as Record<string, Reveal>
    if (pub.winner) {
      const w = document.createElement('p')
      w.className = 'ct__hint'
      w.textContent = `🎉 ${t('phom.u', { name: name(pub.winner as string) })}`
      root.append(w)
    }
    for (const uid of [...order].sort((a, b) => reveal[a].points - reveal[b].points)) {
      const r = reveal[uid]
      const gold = s.meta.results?.[uid] ?? 0
      const box = document.createElement('div')
      box.className = 'mb__result' + (uid === ctx.me ? ' is-me' : '')
      box.innerHTML = `<div class="mb__head"><strong></strong><span class="ct__delta ${gold >= 0 ? 'is-up' : 'is-down'}">${gold >= 0 ? '+' : ''}${gold} 🪙</span></div><div class="mb__slots"></div>`
      box.querySelector('strong')!.textContent = `${name(uid)} · ${t('phom.rest', { n: r.points })}`
      const slots = box.querySelector('.mb__slots')!
      const melded = new Set(r.melds.flat())
      for (const m of r.melds) for (const c of m) slots.append(cardEl(c, { mini: true }))
      for (const c of r.hand.filter((x) => !melded.has(x))) slots.append(cardEl(c, { mini: true, dim: true }))
      root.append(box)
    }
    return
  }

  // Bàn: bài đã đánh của từng người (lá cuối là lá có thể ăn) và phỏm đã ăn.
  const table = document.createElement('div')
  table.className = 'tl__center'
  for (const uid of order) {
    const row = document.createElement('div')
    row.className = 'tl__played'
    const label = document.createElement('span')
    label.className = 'mb__label'
    label.textContent = `${uid === turn ? '▶ ' : ''}${name(uid)} (${done[uid]}/4)`
    row.append(label)
    for (const c of discards[uid]) row.append(cardEl(c, { mini: true, selected: last?.card === c && last.uid === uid }))
    if (eaten[uid].length) {
      const e = document.createElement('span')
      e.className = 'mb__label'
      e.textContent = ` · ${t('phom.ate')}`
      row.append(e)
      for (const c of eaten[uid]) row.append(cardEl(c, { mini: true }))
    }
    table.append(row)
  }
  root.append(table)

  const mine = turn === ctx.me
  const canEatNow = !!last && last.uid !== ctx.me && canEat(s.hand, last.card)
  if (!mine) root.append(banner(t('tl.wait', { name: name(turn) }), false))
  else if (stage === 'draw') {
    root.append(banner(t('phom.drawTurn'), true))
    if (last && last.uid !== ctx.me) {
      const hint = document.createElement('p')
      hint.className = 'ct__hint'
      hint.textContent = canEatNow ? t('phom.canEat', { card: cardText(last.card), name: name(last.uid) }) : t('phom.cantEat', { card: cardText(last.card), name: name(last.uid) })
      root.append(hint)
    }
  } else root.append(banner(t('phom.discardTurn'), true))

  // Tay bài, gom phỏm lên trước và hiện điểm rác.
  const hand = s.hand
  const arr = bestArrangement(hand)
  const melded = new Set(arr.melds.flat())
  const ordered = [...arr.melds.flat(), ...hand.filter((c) => !melded.has(c))]
  const mineEaten = eaten[ctx.me] ?? []
  const fan = document.createElement('div')
  fan.className = 'tl__hand'
  for (const c of ordered) {
    fan.append(cardEl(c, {
      selected: local.selected === c,
      dim: mineEaten.includes(c),
      onClick: () => {
        if (stage !== 'discard' || !mine || mineEaten.includes(c)) return
        local.selected = local.selected === c ? null : c
        ctx.refresh()
      },
    }))
  }
  root.append(fan)
  const rest = document.createElement('p')
  rest.className = 'ct__hint'
  rest.textContent = t('phom.rest', { n: arr.points })
  root.append(rest)

  const bar = document.createElement('div')
  bar.className = 'ct__actions'
  if (mine && stage === 'draw') {
    const draw = document.createElement('button')
    draw.className = 'btn primary'
    draw.textContent = `🂠 ${t('phom.draw', { n: pub.deckCount as number })}`
    draw.disabled = ctx.pending
    draw.addEventListener('click', () => ctx.send({ type: 'draw' }))
    const eat = document.createElement('button')
    eat.className = 'btn'
    eat.disabled = !canEatNow || ctx.pending
    eat.textContent = `🍴 ${t('phom.eat')}`
    eat.addEventListener('click', () => ctx.send({ type: 'eat' }))
    bar.append(draw, eat)
  } else if (mine) {
    const go = document.createElement('button')
    go.className = 'btn primary'
    go.disabled = local.selected === null || ctx.pending
    go.textContent = `⬇ ${t('phom.discard')}`
    go.addEventListener('click', () => {
      ctx.send({ type: 'discard', card: local.selected })
      local.selected = null
    })
    bar.append(go)
  }
  root.append(bar)
}
