import type { Card } from '../../cards/cards.ts'
import { t, tKey } from '../../i18n/index.ts'
import { beats, classify, findPlays, type Combo } from '../../cards/tienLen.ts'
import { animate, banner, cardEl, fanHand } from './cardEl.ts'
import type { ViewCtx, ViewParts } from './table.ts'

interface Local {
  round: number
  selected: Set<Card>
}
let local: Local = { round: -1, selected: new Set() }

interface Last {
  uid: string
  cards: Card[]
}

const btn = (cls: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const b = document.createElement('button')
  b.className = `btn ${cls}`.trim()
  b.textContent = text
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

/** Tiến lên: bài vừa đánh ở giữa bàn, đối thủ quanh bàn, bài của mình xoè quạt ở dưới. */
export function renderTienLen(ctx: ViewCtx): ViewParts {
  const s = ctx.session
  const pub = s.pub!
  if (local.round !== s.meta.round) local = { round: s.meta.round, selected: new Set() }
  const name = (uid: string) => s.seats.find((x) => x.uid === uid)?.name ?? '?'
  const counts = pub.counts as Record<string, number>
  const passed = pub.passed as string[]
  const last = pub.last as Last | null
  const turn = pub.turn as string
  const over = pub.phase === 'result'
  const lastCombo = last ? classify(last.cards) : null
  const mine = turn === ctx.me && !over
  const must = pub.must as number | null

  const center: HTMLElement[] = []
  if (last) {
    const from = document.createElement('div')
    from.className = 'ct__from'
    from.textContent = `${name(last.uid)} · ${tKey(`tl.kind.${lastCombo!.kind}`)}`
    const row = document.createElement('div')
    row.className = 'ct__played'
    last.cards.forEach((c, i) => {
      const el = cardEl(c, { lg: true })
      animate(el, 'is-drop', `tl:${s.meta.round}:${last.uid}:${last.cards.join(',')}`, 400, i, 40)
      row.append(el)
    })
    center.push(from, row)
  } else if (!over) {
    const p = document.createElement('div')
    p.className = 'ct__from'
    p.textContent = t('tl.newRound')
    center.push(p)
  }

  const hand = s.hand.slice().sort((a, b) => a - b)
  for (const c of [...local.selected]) if (!hand.includes(c)) local.selected.delete(c)
  const picked = [...local.selected]
  const combo: Combo | null = picked.length ? classify(picked) : null
  const legal = !!combo && mine && (!lastCombo || beats(lastCombo, combo)) && (must === null || picked.includes(must))

  const fan = fanHand(
    hand.map((c) =>
      cardEl(c, {
        selected: local.selected.has(c),
        onClick: () => {
          if (local.selected.has(c)) local.selected.delete(c)
          else local.selected.add(c)
          ctx.refresh()
        },
      }),
    ),
    `deal:${s.tid}:${s.meta.round}`,
  )

  const actions: HTMLElement[] = []
  if (!over) {
    actions.push(
      btn('primary big', `▶ ${t('tl.play')}`, () => {
        ctx.send({ type: 'play', cards: picked })
        local.selected.clear()
      }, !legal || ctx.pending),
      btn('', t('tl.pass'), () => ctx.send({ type: 'pass' }), !mine || !last || ctx.pending),
      btn('', `💡 ${t('tl.hint')}`, () => {
        const plays = findPlays(hand, lastCombo, must ?? undefined)
        // Gợi ý bộ nhỏ nhất đủ chặt (ưu tiên bộ ít lá hơn).
        plays.sort((a, b) => a.length - b.length || a[a.length - 1] - b[b.length - 1])
        local.selected = new Set(plays[0] ?? [])
        if (!plays.length) ctx.send({ type: 'pass' })
        ctx.refresh()
      }, !mine || ctx.pending),
    )
  }

  const extra: HTMLElement[] = []
  if (!over && picked.length && !combo) {
    const w = document.createElement('p')
    w.className = 'ct__warn'
    w.textContent = t('tl.invalid')
    extra.push(w)
  } else if (combo && mine) {
    const k = document.createElement('p')
    k.className = 'ct__hint'
    k.textContent = `${tKey(`tl.kind.${combo.kind}`)}${legal ? ' ✓' : lastCombo ? ` · ${t('tl.tooWeak')}` : ''}`
    extra.push(k)
  }

  return {
    center,
    flat: false,
    banner: over
      ? banner(t('tl.winner', { name: name(pub.winner as string) }), true)
      : mine
        ? banner(`${t('tl.yourTurn')} · ${lastCombo ? t('tl.beatHint', { kind: tKey(`tl.kind.${lastCombo.kind}`), name: name(last!.uid) }) : must !== null ? t('tl.firstMove') : t('tl.leadHint')}`, true)
        : banner(t('tl.wait', { name: name(turn) }), false),
    extra,
    hand: fan,
    actions,
    seat: (uid) => ({
      cards: over || uid === ctx.me ? undefined : counts[uid],
      tag: over && uid === pub.winner ? `🏆 ${t('tl.out')}` : over ? t('tl.cardsLeft', { n: counts[uid] }) : passed.includes(uid) ? t('tl.passed') : undefined,
      tagKind: over && uid === pub.winner ? 'ok' : passed.includes(uid) ? 'bad' : undefined,
    }),
  }
}
