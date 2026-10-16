import { autoArrange, evalHand, isValidOrder, specialOf, type Arrangement } from '../../cards/mauBinh.ts'
import type { Card } from '../../cards/cards.ts'
import { sortCards } from '../../cards/cards.ts'
import { t, tKey } from '../../i18n/index.ts'
import { cardEl } from './cardEl.ts'
import type { ViewCtx } from './table.ts'

const SIZES = [3, 5, 5]

interface Local {
  round: number
  chi: Card[][]
  selected: Card | null
}
let local: Local = { round: -1, chi: [[], [], []], selected: null }

const catName = (cards: Card[]): string => tKey(`mb.cat.${evalHand(cards).cat}`)

/** Màn Mậu binh: xếp 13 lá thành 3 chi, rồi xem kết quả so từng chi. */
export function renderMauBinh(root: HTMLElement, ctx: ViewCtx): void {
  const pub = ctx.session.pub
  if (!pub) return
  const round = ctx.session.meta.round
  if (local.round !== round) local = { round, chi: [[], [], []], selected: null }

  if (pub.phase === 'result') return renderResult(root, ctx)

  const submitted = (pub.submitted as string[]).includes(ctx.me)
  const hand = sortCards(ctx.session.hand)
  const left = Math.max(0, Math.ceil(((pub.deadline as number) - Date.now()) / 1000))
  const title = document.createElement('p')
  title.className = 'ct__hint'
  title.textContent = submitted ? t('mb.waiting', { n: (pub.order as string[]).length - (pub.submitted as string[]).length }) : t('mb.arrange', { s: left })
  root.append(title)
  if (!hand.length) return

  const special = specialOf(hand)
  if (special && !submitted) {
    const box = document.createElement('div')
    box.className = 'ct__special'
    box.textContent = `🎉 ${tKey(`mb.special.${special}`)}`
    const go = document.createElement('button')
    go.className = 'btn primary'
    go.textContent = t('mb.declare')
    go.addEventListener('click', () => ctx.send({ type: 'submit', chi: autoArrange(hand) }))
    box.append(go)
    root.append(box)
  }

  // Bài chưa xếp = bài trên tay trừ bài đã đặt vào chi.
  const placed = new Set(local.chi.flat())
  const pool = hand.filter((c) => !placed.has(c))

  const rows = document.createElement('div')
  rows.className = 'mb__rows'
  local.chi.forEach((cards, i) => {
    const row = document.createElement('div')
    row.className = 'mb__row'
    const label = document.createElement('span')
    label.className = 'mb__label'
    label.textContent = `${t('mb.chi', { n: i + 1 })}${cards.length === SIZES[i] ? ` · ${catName(cards)}` : ` (${cards.length}/${SIZES[i]})`}`
    const slots = document.createElement('div')
    slots.className = 'mb__slots'
    for (const c of cards) slots.append(cardEl(c, {
      onClick: submitted ? undefined : () => {
        local.chi[i] = local.chi[i].filter((x) => x !== c)
        ctx.refresh()
      },
    }))
    for (let k = cards.length; k < SIZES[i]; k++) slots.append(cardEl(null, { mini: false }))
    if (!submitted) {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.pc:not(.pc--back)')) return
        if (local.selected === null || local.chi[i].length >= SIZES[i]) return
        local.chi[i].push(local.selected)
        local.selected = null
        ctx.refresh()
      })
    }
    row.append(label, slots)
    rows.append(row)
  })
  root.append(rows)

  if (submitted) return

  const poolEl = document.createElement('div')
  poolEl.className = 'mb__pool'
  for (const c of pool) {
    poolEl.append(cardEl(c, {
      selected: local.selected === c,
      onClick: () => {
        local.selected = local.selected === c ? null : c
        ctx.refresh()
      },
    }))
  }
  root.append(poolEl)

  const full = pool.length === 0
  if (full && !isValidOrder(local.chi as Arrangement)) {
    const warn = document.createElement('p')
    warn.className = 'ct__warn'
    warn.textContent = `⚠️ ${t('mb.lung')}`
    root.append(warn)
  }
  const bar = document.createElement('div')
  bar.className = 'ct__actions'
  const auto = document.createElement('button')
  auto.className = 'btn'
  auto.textContent = `✨ ${t('mb.auto')}`
  auto.addEventListener('click', () => {
    local.chi = autoArrange(hand).map((c) => c.slice())
    local.selected = null
    ctx.refresh()
  })
  const clear = document.createElement('button')
  clear.className = 'btn'
  clear.textContent = `↺ ${t('mb.reset')}`
  clear.addEventListener('click', () => {
    local.chi = [[], [], []]
    ctx.refresh()
  })
  const done = document.createElement('button')
  done.className = 'btn primary'
  done.disabled = !full
  done.textContent = `✅ ${t('mb.done')}`
  done.addEventListener('click', () => ctx.send({ type: 'submit', chi: local.chi }))
  bar.append(auto, clear, done)
  root.append(bar)
}

function renderResult(root: HTMLElement, ctx: ViewCtx): void {
  const pub = ctx.session.pub!
  const reveal = pub.reveal as Record<string, { chi: Card[][]; special: string | null; lung: boolean }>
  const results = ctx.session.meta.results ?? {}
  for (const seat of ctx.session.seats.filter((s) => reveal[s.uid])) {
    const r = reveal[seat.uid]
    const gold = results[seat.uid] ?? 0
    const box = document.createElement('div')
    box.className = 'mb__result' + (seat.uid === ctx.me ? ' is-me' : '')
    const head = document.createElement('div')
    head.className = 'mb__head'
    const tag = r.special ? ` 🎉 ${tKey(`mb.special.${r.special}`)}` : r.lung ? ` ⚠️ ${t('mb.lungTag')}` : ''
    head.innerHTML = `<strong></strong><span class="ct__delta ${gold >= 0 ? 'is-up' : 'is-down'}">${gold >= 0 ? '+' : ''}${gold} 🪙</span>`
    head.querySelector('strong')!.textContent = `${seat.name}${tag}`
    box.append(head)
    r.chi.forEach((cards, i) => {
      const row = document.createElement('div')
      row.className = 'mb__row mb__row--mini'
      const label = document.createElement('span')
      label.className = 'mb__label'
      label.textContent = catName(cards)
      const slots = document.createElement('div')
      slots.className = 'mb__slots'
      for (const c of cards) slots.append(cardEl(c, { mini: true }))
      row.append(label, slots)
      box.append(row)
      void i
    })
    root.append(box)
  }
}
