import type { GameState } from '../core/state.ts'
import { ITEMS } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import type { Profile } from '../online/cloud.ts'
import { answerTrade, cancelTrade, proposeTrade, trades, type Trade } from '../online/trade.ts'
import { giftable } from '../systems/friendship.ts'
import { countItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'
import { closePanel, openPanel } from './panel.ts'

/** Loại vật phẩm đổi được (không đổi dụng cụ, nội thất, hạt giống). */
const TRADEABLE = new Set(['crop', 'fruit', 'fish', 'product', 'jar', 'food'])

/** Cửa sổ soạn đề nghị đổi đồ với một người bạn. */
export function openTradeComposer(state: GameState, friend: Profile, onDone: () => void): void {
  let give: string | null = null
  let giveQty = 1
  let want: string | null = null
  let wantQty = 1
  openPanel({
    title: () => `🔄 ${t('trade.with', { name: friend.name })}`,
    render(body, refresh) {
      body.append(heading(t('trade.give')))
      body.append(picker(giftable(state).filter((id) => TRADEABLE.has(ITEMS.get(id)!.kind)), give, (id) => {
        give = id
        giveQty = 1
        refresh()
      }, (id) => countItem(state.inventory, id)))
      if (give) body.append(stepper(giveQty, 1, countItem(state.inventory, give), (n) => {
        giveQty = n
        refresh()
      }))
      body.append(heading(t('trade.want')))
      body.append(picker([...ITEMS.values()].filter((d) => TRADEABLE.has(d.kind)).map((d) => d.id), want, (id) => {
        want = id
        refresh()
      }))
      if (want) body.append(stepper(wantQty, 1, 20, (n) => {
        wantQty = n
        refresh()
      }))
      const send = document.createElement('button')
      send.className = 'btn primary'
      send.textContent = give && want ? t('trade.send', { give: `${giveQty} ${itemName(give)}`, want: `${wantQty} ${itemName(want)}` }) : t('trade.pick')
      send.disabled = !give || !want
      send.addEventListener('click', () => {
        if (!give || !want) return
        send.disabled = true
        void proposeTrade(state, friend, { item: give, qty: giveQty }, { item: want, qty: wantQty }).then((ok) => {
          if (ok) {
            closePanel()
            onDone()
          } else send.disabled = false
        })
      })
      body.append(send)
    },
  })
}

/** Mục "Đổi đồ" trong cửa sổ Bạn bè: đề nghị gửi tới mình và đề nghị mình đang chờ. */
export function renderTrades(body: HTMLElement, state: GameState, refresh: () => void): void {
  if (trades.incoming.length === 0 && trades.outgoing.length === 0) return
  const box = document.createElement('section')
  box.className = 'menu-section'
  box.append(heading(`🔄 ${t('trade.title')}`))
  for (const tr of trades.incoming) box.append(tradeRow(tr, t('trade.incoming', { name: tr.fromName }), [
    [t('trade.accept'), 'btn small primary', countItem(state.inventory, tr.want.item) >= tr.want.qty, () => answerTrade(state, tr, true)],
    [t('trade.decline'), 'btn small', true, () => answerTrade(state, tr, false)],
  ]))
  for (const tr of trades.outgoing) box.append(tradeRow(tr, t('trade.outgoing', { name: tr.toName }), [
    [t('request.cancel'), 'btn small', true, () => cancelTrade(state, tr)],
  ]))
  body.append(box)

  function tradeRow(tr: Trade, title: string, actions: [string, string, boolean, () => Promise<unknown>][]): HTMLElement {
    const row = document.createElement('div')
    row.className = 'row trade-row'
    row.innerHTML = `<span class="row-main"><strong></strong><span class="trade-row__deal"></span></span>`
    row.querySelector('strong')!.textContent = title
    row.querySelector('.trade-row__deal')!.innerHTML = `${itemIconHtml(tr.give.item)}<b>×${tr.give.qty}</b><span>⇄</span>${itemIconHtml(tr.want.item)}<b>×${tr.want.qty}</b>`
    for (const [label, cls, enabled, run] of actions) {
      const b = document.createElement('button')
      b.className = cls
      b.textContent = label
      b.disabled = !enabled
      b.addEventListener('click', () => {
        b.disabled = true
        void run().then(refresh)
      })
      row.append(b)
    }
    return row
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3')
  h.className = 'trade-heading'
  h.textContent = text
  return h
}

function picker(ids: string[], selected: string | null, onPick: (id: string) => void, count?: (id: string) => number): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'gift-pick'
  if (ids.length === 0) wrap.textContent = t('friend.nothing')
  for (const id of ids) {
    const b = document.createElement('button')
    b.className = 'slot gift-pick__item' + (id === selected ? ' is-selected' : '')
    b.innerHTML = itemIconHtml(id) + (count ? `<span class="count">${count(id)}</span>` : '')
    b.title = itemName(id)
    b.addEventListener('click', () => onPick(id))
    wrap.append(b)
  }
  return wrap
}

function stepper(value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'trade-stepper'
  const minus = document.createElement('button')
  minus.className = 'btn small'
  minus.textContent = '−'
  minus.disabled = value <= min
  minus.addEventListener('click', () => onChange(Math.max(min, value - 1)))
  const v = document.createElement('strong')
  v.textContent = `×${value}`
  const plus = document.createElement('button')
  plus.className = 'btn small'
  plus.textContent = '+'
  plus.disabled = value >= max
  plus.addEventListener('click', () => onChange(Math.min(max, value + 1)))
  row.append(minus, v, plus)
  return row
}
