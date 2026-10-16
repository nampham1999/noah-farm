import type { Card } from '../../cards/cards.ts'
import { cardText } from '../../cards/cards.ts'
import { bestArrangement, canEat } from '../../cards/phom.ts'
import { t } from '../../i18n/index.ts'
import { animate, banner, cardEl, fanHand } from './cardEl.ts'
import type { ViewCtx, ViewParts } from './table.ts'

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

/** Phỏm: cọc bài đã đánh của từng người ở giữa bàn; bốc/ăn rồi đánh; hạ bài khi hết 4 lượt. */
export function renderPhom(ctx: ViewCtx): ViewParts {
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
  const mine = turn === ctx.me && !over

  const center: HTMLElement[] = []
  if (over) {
    const reveal = pub.reveal as Record<string, Reveal>
    if (pub.winner) {
      const w = document.createElement('p')
      w.className = 'ct__hint'
      w.textContent = `🎉 ${t('phom.u', { name: name(pub.winner as string) })}`
      center.push(w)
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
      center.push(box)
    }
  } else {
    // Cọc bài đã đánh của từng người; lá cuối của người trước là lá có thể ăn.
    const piles = document.createElement('div')
    piles.className = 'ct__piles'
    for (const uid of order) {
      const row = document.createElement('div')
      row.className = 'ct__pile' + (uid === turn ? ' is-turn' : '')
      row.append(`${name(uid)} ${done[uid]}/4 `)
      for (const c of discards[uid]) {
        const el = cardEl(c, { selected: last?.card === c && last.uid === uid })
        if (last?.card === c && last.uid === uid) animate(el, 'is-drop', `ph:${s.meta.round}:${uid}:${c}`, 400)
        row.append(el)
      }
      if (eaten[uid].length) {
        row.append(`🍴`)
        for (const c of eaten[uid]) row.append(cardEl(c))
      }
      piles.append(row)
    }
    center.push(piles)
  }

  const canEatNow = !!last && last.uid !== ctx.me && canEat(s.hand, last.card)
  const arr = bestArrangement(s.hand)
  const melded = new Set(arr.melds.flat())
  const ordered: Card[] = []
  const groups = new Set<number>()
  for (const m of arr.melds) {
    groups.add(ordered.length)
    ordered.push(...m)
  }
  groups.add(ordered.length)
  ordered.push(...s.hand.filter((c) => !melded.has(c)))
  const mineEaten = eaten[ctx.me] ?? []
  const fan = fanHand(
    ordered.map((c) =>
      cardEl(c, {
        selected: local.selected === c,
        dim: mineEaten.includes(c),
        onClick: () => {
          if (stage !== 'discard' || !mine || mineEaten.includes(c)) return
          local.selected = local.selected === c ? null : c
          ctx.refresh()
        },
      }),
    ),
    `deal:${s.tid}:${s.meta.round}`,
    groups,
  )

  const actions: HTMLElement[] = []
  const mk = (cls: string, text: string, onClick: () => void, disabled: boolean) => {
    const b = document.createElement('button')
    b.className = `btn ${cls}`
    b.textContent = text
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }
  const extra: HTMLElement[] = []
  let bn: HTMLElement | undefined
  if (!over) {
    if (!mine) bn = banner(t('tl.wait', { name: name(turn) }), false)
    else if (stage === 'draw') {
      bn = banner(t('phom.drawTurn'), true)
      if (last && last.uid !== ctx.me) {
        const hint = document.createElement('p')
        hint.className = 'ct__hint'
        hint.textContent = canEatNow ? t('phom.canEat', { card: cardText(last.card), name: name(last.uid) }) : t('phom.cantEat', { card: cardText(last.card), name: name(last.uid) })
        extra.push(hint)
      }
      actions.push(
        mk('primary big', `🂠 ${t('phom.draw', { n: pub.deckCount as number })}`, () => ctx.send({ type: 'draw' }), ctx.pending),
        mk('', `🍴 ${t('phom.eat')}`, () => ctx.send({ type: 'eat' }), !canEatNow || ctx.pending),
      )
    } else {
      bn = banner(t('phom.discardTurn'), true)
      actions.push(
        mk('primary big', `⬇ ${t('phom.discard')}`, () => {
          ctx.send({ type: 'discard', card: local.selected })
          local.selected = null
        }, local.selected === null || ctx.pending),
      )
    }
    const rest = document.createElement('p')
    rest.className = 'ct__hint'
    rest.textContent = t('phom.rest', { n: arr.points })
    extra.push(rest)
  }

  return {
    center,
    flat: over,
    banner: bn,
    extra,
    hand: fan,
    actions,
    seat: (uid) => ({ tag: `${done[uid]}/4`, tagKind: undefined }),
  }
}
