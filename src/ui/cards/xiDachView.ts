import type { Card } from '../../cards/cards.ts'
import { bestTotal, classOf, DEALER_MIN, PLAYER_MIN } from '../../cards/xiDach.ts'
import { t, tKey } from '../../i18n/index.ts'
import { banner, cardEl } from './cardEl.ts'
import type { ViewCtx } from './table.ts'

const label = (cards: Card[]): string => {
  const c = classOf(cards)
  return c.cls === 2 ? t('xd.points', { n: c.points }) : tKey(`xd.cls.${c.cls}`)
}

/** Màn Xì dách: nhà cái là chủ bàn; con rút hoặc dằn rồi so điểm với nhà cái. */
export function renderXiDach(root: HTMLElement, ctx: ViewCtx): void {
  const s = ctx.session
  const pub = s.pub!
  const order = pub.order as string[]
  const dealer = order[0]
  const counts = pub.counts as Record<string, number>
  const done = pub.done as string[]
  const turn = pub.turn as string
  const over = pub.phase === 'result'
  const name = (uid: string) => s.seats.find((x) => x.uid === uid)?.name ?? '?'

  if (over) {
    const reveal = pub.reveal as Record<string, Card[]>
    const units = pub.units as Record<string, number>
    for (const uid of order) {
      const box = document.createElement('div')
      box.className = 'mb__result' + (uid === ctx.me ? ' is-me' : '')
      const gold = s.meta.results?.[uid] ?? 0
      box.innerHTML = `<div class="mb__head"><strong></strong><span class="ct__delta ${gold >= 0 ? 'is-up' : 'is-down'}">${gold >= 0 ? '+' : ''}${gold} 🪙</span></div><div class="mb__slots"></div>`
      box.querySelector('strong')!.textContent = `${uid === dealer ? '🎩 ' : ''}${name(uid)} · ${label(reveal[uid])}`
      const slots = box.querySelector('.mb__slots')!
      for (const c of reveal[uid]) slots.append(cardEl(c, { mini: true }))
      root.append(box)
    }
    void units
    return
  }

  const foes = document.createElement('div')
  foes.className = 'tl__foes'
  for (const uid of order.filter((u) => u !== ctx.me)) {
    const f = document.createElement('div')
    f.className = 'tl__foe' + (uid === turn ? ' is-turn' : '')
    f.innerHTML = '<strong></strong><span></span>'
    f.querySelector('strong')!.textContent = `${uid === dealer ? '🎩 ' : ''}${name(uid)}`
    f.querySelector('span')!.textContent = `🂠 ${counts[uid]}${done.includes(uid) ? ` · ${t('xd.stood')}` : ''}`
    foes.append(f)
  }
  root.append(foes)

  const hand = s.hand
  const mine = turn === ctx.me
  root.append(banner(mine ? t('xd.yourTurn') : done.includes(ctx.me) ? t('xd.waitOthers') : t('tl.wait', { name: name(turn) }), mine))

  const mineBox = document.createElement('div')
  mineBox.className = 'tl__center'
  const row = document.createElement('div')
  row.className = 'tl__played'
  for (const c of hand) row.append(cardEl(c))
  const total = document.createElement('p')
  total.className = 'ct__hint'
  total.textContent = hand.length ? label(hand) : ''
  mineBox.append(row, total)
  root.append(mineBox)

  const min = ctx.me === dealer ? DEALER_MIN : PLAYER_MIN
  const bar = document.createElement('div')
  bar.className = 'ct__actions'
  const hit = document.createElement('button')
  hit.className = 'btn primary'
  hit.disabled = !mine || hand.length >= 5 || ctx.pending
  hit.textContent = `➕ ${t('xd.hit')}`
  hit.addEventListener('click', () => ctx.send({ type: 'hit' }))
  const stand = document.createElement('button')
  stand.className = 'btn'
  stand.disabled = !mine || (hand.length < 5 && bestTotal(hand) < min) || ctx.pending
  stand.textContent = `✋ ${t('xd.stand')}`
  stand.addEventListener('click', () => ctx.send({ type: 'stand' }))
  bar.append(hit, stand)
  root.append(bar)
  if (mine && hand.length < 5 && bestTotal(hand) < min) {
    const w = document.createElement('p')
    w.className = 'ct__hint'
    w.textContent = t('xd.needMin', { n: min })
    root.append(w)
  }
}
