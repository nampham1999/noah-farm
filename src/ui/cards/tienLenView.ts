import type { Card } from '../../cards/cards.ts'
import { t, tKey } from '../../i18n/index.ts'
import { beats, classify, findPlays, type Combo } from '../../cards/tienLen.ts'
import { cardEl } from './cardEl.ts'
import type { ViewCtx } from './table.ts'

interface Local {
  round: number
  selected: Set<Card>
}
let local: Local = { round: -1, selected: new Set() }

interface Last {
  uid: string
  cards: Card[]
}

/** Màn Tiến lên: bài của mình ở dưới, bài vừa đánh ở giữa, đối thủ ở trên. */
export function renderTienLen(root: HTMLElement, ctx: ViewCtx): void {
  const s = ctx.session
  const pub = s.pub!
  if (local.round !== s.meta.round) local = { round: s.meta.round, selected: new Set() }
  const name = (uid: string) => s.seats.find((x) => x.uid === uid)?.name ?? '?'
  const order = pub.order as string[]
  const counts = pub.counts as Record<string, number>
  const passed = pub.passed as string[]
  const last = pub.last as Last | null
  const turn = pub.turn as string
  const over = pub.phase === 'result'

  const foes = document.createElement('div')
  foes.className = 'tl__foes'
  for (const uid of order.filter((u) => u !== ctx.me)) {
    const f = document.createElement('div')
    f.className = 'tl__foe' + (uid === turn && !over ? ' is-turn' : '')
    const left = counts[uid] ?? 0
    f.innerHTML = '<strong></strong><span></span>'
    f.querySelector('strong')!.textContent = name(uid)
    f.querySelector('span')!.textContent = over && uid === pub.winner ? `🏆` : passed.includes(uid) ? t('tl.passed') : `🂠 ${left}`
    foes.append(f)
  }
  root.append(foes)

  const center = document.createElement('div')
  center.className = 'tl__center'
  const info = document.createElement('p')
  info.className = 'ct__hint'
  if (over) info.textContent = t('tl.winner', { name: name(pub.winner as string) })
  else if (turn === ctx.me) info.textContent = t('tl.yourTurn', { s: Math.max(0, Math.ceil(((pub.deadline as number) - Date.now()) / 1000)) })
  else info.textContent = t('tl.wait', { name: name(turn) })
  center.append(info)
  const played = document.createElement('div')
  played.className = 'tl__played'
  if (last) {
    const who = document.createElement('span')
    who.className = 'mb__label'
    who.textContent = name(last.uid)
    played.append(who)
    for (const c of last.cards) played.append(cardEl(c))
  } else if (!over) {
    const p = document.createElement('span')
    p.className = 'mb__label'
    p.textContent = pub.must !== null ? t('tl.firstMove') : t('tl.freeLead')
    played.append(p)
  }
  center.append(played)
  root.append(center)

  if (over) {
    for (const uid of order) {
      const row = document.createElement('div')
      row.className = 'mb__result' + (uid === ctx.me ? ' is-me' : '')
      const gold = s.meta.results?.[uid] ?? 0
      row.innerHTML = `<div class="mb__head"><strong></strong><span class="ct__delta ${gold >= 0 ? 'is-up' : 'is-down'}">${gold >= 0 ? '+' : ''}${gold} 🪙</span></div>`
      row.querySelector('strong')!.textContent = `${name(uid)} · ${uid === pub.winner ? t('tl.out') : t('tl.cardsLeft', { n: counts[uid] })}`
      root.append(row)
    }
  }

  // Tay bài của mình, xếp chồng nhẹ để vừa màn hình điện thoại.
  const hand = s.hand.slice().sort((a, b) => a - b)
  for (const c of [...local.selected]) if (!hand.includes(c)) local.selected.delete(c)
  const fan = document.createElement('div')
  fan.className = 'tl__hand'
  for (const c of hand) {
    fan.append(cardEl(c, {
      selected: local.selected.has(c),
      onClick: () => {
        if (local.selected.has(c)) local.selected.delete(c)
        else local.selected.add(c)
        ctx.refresh()
      },
    }))
  }
  root.append(fan)
  if (over) return

  const mine = turn === ctx.me
  const picked = [...local.selected]
  const combo: Combo | null = picked.length ? classify(picked) : null
  const lastCombo = last ? classify(last.cards) : null
  const must = pub.must as number | null
  const legal = !!combo && mine && (!lastCombo || beats(lastCombo, combo)) && (must === null || picked.includes(must))

  const bar = document.createElement('div')
  bar.className = 'ct__actions'
  const play = document.createElement('button')
  play.className = 'btn primary'
  play.disabled = !legal
  play.textContent = `▶ ${t('tl.play')}`
  play.addEventListener('click', () => {
    ctx.send({ type: 'play', cards: picked })
    local.selected.clear()
  })
  const pass = document.createElement('button')
  pass.className = 'btn'
  pass.disabled = !mine || !last
  pass.textContent = t('tl.pass')
  pass.addEventListener('click', () => ctx.send({ type: 'pass' }))
  const hint = document.createElement('button')
  hint.className = 'btn'
  hint.disabled = !mine
  hint.textContent = `💡 ${t('tl.hint')}`
  hint.addEventListener('click', () => {
    const plays = findPlays(hand, lastCombo, must ?? undefined)
    // Gợi ý bộ nhỏ nhất đủ chặt (ưu tiên bộ ít lá hơn).
    plays.sort((a, b) => a.length - b.length || a[a.length - 1] - b[b.length - 1])
    local.selected = new Set(plays[0] ?? [])
    if (!plays.length) ctx.send({ type: 'pass' })
    ctx.refresh()
  })
  const clear = document.createElement('button')
  clear.className = 'btn'
  clear.textContent = '✖'
  clear.disabled = !picked.length
  clear.addEventListener('click', () => {
    local.selected.clear()
    ctx.refresh()
  })
  bar.append(play, pass, hint, clear)
  root.append(bar)
  if (picked.length && !combo) {
    const w = document.createElement('p')
    w.className = 'ct__warn'
    w.textContent = t('tl.invalid')
    root.append(w)
  } else if (combo && mine) {
    const k = document.createElement('p')
    k.className = 'ct__hint'
    k.textContent = tKey(`tl.kind.${combo.kind}`)
    root.append(k)
  }
}
