import { autoArrange, evalHand, isValidOrder, specialOf, type Arrangement } from '../../cards/mauBinh.ts'
import type { Card } from '../../cards/cards.ts'
import { sortCards } from '../../cards/cards.ts'
import { t, tKey } from '../../i18n/index.ts'
import { animate, banner, cardEl } from './cardEl.ts'
import type { ViewCtx, ViewParts } from './table.ts'

const SIZES = [3, 5, 5]

interface Local {
  round: number
  chi: Card[][]
}
let local: Local = { round: -1, chi: [[], [], []] }

const catName = (cards: Card[]): string => tKey(`mb.cat.${evalHand(cards).cat}`)

const btn = (cls: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const b = document.createElement('button')
  b.className = `btn ${cls}`.trim()
  b.textContent = text
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

/** Mậu binh: xếp 13 lá thành 3 chi trên một "bàn xếp bài", rồi xem kết quả so từng chi. */
export function renderMauBinh(ctx: ViewCtx): ViewParts {
  const s = ctx.session
  const pub = s.pub!
  const round = s.meta.round
  if (local.round !== round) local = { round, chi: [[], [], []] }
  const submittedList = pub.submitted as string[]
  const seat = (uid: string) => ({
    tag: pub.phase === 'result' ? undefined : submittedList.includes(uid) ? `✅ ${t('mb.sent')}` : t('mb.arranging'),
    tagKind: submittedList.includes(uid) ? ('ok' as const) : undefined,
  })

  if (pub.phase === 'result') return { center: resultRows(ctx), flat: true, actions: [], seat }

  const submitted = submittedList.includes(ctx.me)
  const hand = sortCards(s.hand)
  const center: HTMLElement[] = []
  const extra: HTMLElement[] = []

  const special = specialOf(hand)
  if (special && !submitted) {
    const box = document.createElement('div')
    box.className = 'ct__special'
    box.textContent = `🎉 ${tKey(`mb.special.${special}`)}`
    box.append(btn('primary', t('mb.declare'), () => ctx.send({ type: 'submit', chi: autoArrange(hand) }), ctx.pending))
    center.push(box)
  }

  // Ba chi: chi 1 (3 lá) trên cùng, chi 3 (mạnh nhất) dưới cùng, như các app mậu binh quen thuộc.
  const rows = document.createElement('div')
  rows.className = 'mb__rows'
  local.chi.forEach((cards, i) => {
    const row = document.createElement('div')
    row.className = 'mb__row' + (cards.length === SIZES[i] ? ' is-full' : '')
    const label = document.createElement('span')
    label.className = 'mb__label'
    label.textContent = `${t('mb.chi', { n: i + 1 })}${cards.length === SIZES[i] ? ` · ${catName(cards)}` : ` (${cards.length}/${SIZES[i]})`}`
    const slots = document.createElement('div')
    slots.className = 'mb__slots'
    for (const c of cards) {
      slots.append(cardEl(c, {
        onClick: submitted ? undefined : () => {
          local.chi[i] = local.chi[i].filter((x) => x !== c)
          ctx.refresh()
        },
      }))
    }
    for (let k = cards.length; k < SIZES[i]; k++) slots.append(cardEl(null, { empty: true }))
    row.append(label, slots)
    rows.append(row)
  })
  center.push(rows)

  // Bài chưa xếp: chạm một lá là vào chi còn chỗ (chi 3 trước, rồi chi 2, chi 1).
  const placed = new Set(local.chi.flat())
  const pool = hand.filter((c) => !placed.has(c))
  const poolEl = document.createElement('div')
  poolEl.className = 'mb__pool'
  pool.forEach((c, i) => {
    const el = cardEl(c, {
      onClick: submitted ? undefined : () => {
        const open = [2, 1, 0].find((k) => local.chi[k].length < SIZES[k])
        if (open !== undefined) local.chi[open].push(c)
        ctx.refresh()
      },
    })
    animate(el, 'is-deal', `deal:${s.tid}:${round}`, 700, i, 50)
    poolEl.append(el)
  })

  const full = pool.length === 0
  if (full && !submitted && !isValidOrder(local.chi as Arrangement)) {
    const warn = document.createElement('p')
    warn.className = 'ct__warn'
    warn.textContent = `⚠️ ${t('mb.lung')}`
    extra.push(warn)
  }
  const actions = submitted
    ? []
    : [
        btn('', `✨ ${t('mb.auto')}`, () => {
          local.chi = autoArrange(hand).map((c) => c.slice())
          ctx.refresh()
        }),
        btn('', `↺ ${t('mb.reset')}`, () => {
          local.chi = [[], [], []]
          ctx.refresh()
        }),
        btn('primary big', `✅ ${t('mb.done')}`, () => ctx.send({ type: 'submit', chi: local.chi }), !full || ctx.pending),
      ]
  return {
    center,
    flat: true,
    banner: banner(submitted ? t('mb.waiting', { n: (pub.order as string[]).length - submittedList.length }) : t('mb.arrange'), !submitted),
    extra,
    hand: submitted ? undefined : poolEl,
    actions,
    seat,
  }
}

function resultRows(ctx: ViewCtx): HTMLElement[] {
  const s = ctx.session
  const reveal = s.pub!.reveal as Record<string, { chi: Card[][]; special: string | null; lung: boolean }>
  const results = s.meta.results ?? {}
  const out: HTMLElement[] = []
  for (const seat of s.seats.filter((x) => reveal[x.uid])) {
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
      cards.forEach((c, k) => {
        const el = cardEl(c, { mini: true })
        // Lật bài lần lượt từng chi.
        animate(el, 'is-deal', `mbr:${s.tid}:${s.meta.round}:${seat.uid}:${i}`, 500, k + i * 5, 70)
        slots.append(el)
      })
      row.append(label, slots)
      box.append(row)
    })
    out.push(box)
  }
  return out
}
