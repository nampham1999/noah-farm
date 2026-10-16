import type { Card } from '../../cards/cards.ts'
import { bestTotal, classOf, DEALER_MIN, PLAYER_MIN } from '../../cards/xiDach.ts'
import { t, tKey } from '../../i18n/index.ts'
import { animate, banner, cardEl, fanHand } from './cardEl.ts'
import type { ViewCtx, ViewParts } from './table.ts'

const label = (cards: Card[]): string => {
  const c = classOf(cards)
  return c.cls === 2 ? t('xd.points', { n: c.points }) : tKey(`xd.cls.${c.cls}`)
}

/** Xì dách: nhà cái ngồi đầu bàn, mình ở dưới; rút hoặc dằn rồi so điểm với nhà cái. */
export function renderXiDach(ctx: ViewCtx): ViewParts {
  const s = ctx.session
  const pub = s.pub!
  const order = pub.order as string[]
  const dealer = order[0]
  const counts = pub.counts as Record<string, number>
  const done = pub.done as string[]
  const turn = pub.turn as string
  const over = pub.phase === 'result'
  const name = (uid: string) => s.seats.find((x) => x.uid === uid)?.name ?? '?'
  const hand = s.hand
  const mine = turn === ctx.me && !over
  const min = ctx.me === dealer ? DEALER_MIN : PLAYER_MIN

  const center: HTMLElement[] = []
  if (over) {
    const reveal = pub.reveal as Record<string, Card[]>
    for (const uid of order) {
      const box = document.createElement('div')
      box.className = 'mb__result' + (uid === ctx.me ? ' is-me' : '')
      const gold = s.meta.results?.[uid] ?? 0
      box.innerHTML = `<div class="mb__head"><strong></strong><span class="ct__delta ${gold >= 0 ? 'is-up' : 'is-down'}">${gold >= 0 ? '+' : ''}${gold} 🪙</span></div><div class="mb__slots"></div>`
      box.querySelector('strong')!.textContent = `${uid === dealer ? '🎩 ' : ''}${name(uid)} · ${label(reveal[uid])}`
      const slots = box.querySelector('.mb__slots')!
      reveal[uid].forEach((c, i) => {
        const el = cardEl(c, { mini: true })
        animate(el, 'is-deal', `xdr:${s.tid}:${s.meta.round}:${uid}`, 600, i, 80)
        slots.append(el)
      })
      center.push(box)
    }
  } else {
    const info = document.createElement('div')
    info.className = 'ct__from'
    info.textContent = `🎩 ${t('xd.dealer', { name: name(dealer) })}`
    center.push(info)
    if (hand.length) {
      const total = document.createElement('div')
      total.style.cssText = 'font:800 26px Fredoka,sans-serif'
      total.textContent = label(hand)
      center.push(total)
    }
  }

  const fan = fanHand(hand.map((c) => cardEl(c, { lg: true })), `deal:${s.tid}:${s.meta.round}`)
  const mk = (cls: string, text: string, move: string, disabled: boolean) => {
    const b = document.createElement('button')
    b.className = `btn ${cls}`
    b.textContent = text
    b.disabled = disabled
    b.addEventListener('click', () => ctx.send({ type: move }))
    return b
  }
  const actions = over
    ? []
    : [
        mk('primary big', `➕ ${t('xd.hit')}`, 'hit', !mine || hand.length >= 5 || ctx.pending),
        mk('', `✋ ${t('xd.stand')}`, 'stand', !mine || (hand.length < 5 && bestTotal(hand) < min) || ctx.pending),
      ]
  const extra: HTMLElement[] = []
  if (mine && hand.length < 5 && bestTotal(hand) < min) {
    const w = document.createElement('p')
    w.className = 'ct__hint'
    w.textContent = t('xd.needMin', { n: min })
    extra.push(w)
  }
  return {
    center,
    flat: over,
    banner: over ? undefined : banner(mine ? t('xd.yourTurn') : done.includes(ctx.me) ? t('xd.waitOthers') : t('tl.wait', { name: name(turn) }), mine),
    extra,
    hand: fan,
    actions,
    seat: (uid) => ({
      cards: over || uid === ctx.me ? undefined : counts[uid],
      tag: done.includes(uid) && !over ? t('xd.stood') : undefined,
      tagKind: done.includes(uid) ? 'ok' : undefined,
    }),
  }
}
