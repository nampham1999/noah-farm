import type { GameState } from '../core/state.ts'
import { item, ITEMS } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import { buy, collectSales, listItem, listings, STALL_SLOTS, unlist, type Listing } from '../online/market.ts'
import { online } from '../online/online.ts'
import { countItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'
import type { PanelSpec } from './panel.ts'

/** Loại vật phẩm bày bán được (không bán dụng cụ, hạt giống, nội thất). */
const SELLABLE = new Set(['crop', 'fruit', 'fish', 'product', 'jar', 'food'])

/**
 * Cửa sổ sạp hàng. owner null: sạp của mình (bày, cất, thu tiền); có owner: sạp bạn (mua).
 * me: tên và số vàng của mình (khi đang thăm, trạng thái đang mở là của bạn).
 */
export function stallPanel(state: GameState, owner: { uid: string; name: string } | null, me: () => { name: string; gold: number }, visiting: boolean): PanelSpec {
  let list: Listing[] | null = null
  let loading = false
  // Đang soạn món mới cho ô trống nào (sạp của mình).
  let composing: number | null = null
  let pick: string | null = null
  let qty = 1
  let price = 0

  const load = (refresh: () => void) => {
    if (loading || !online.cloud) return
    loading = true
    const uid = owner?.uid ?? online.cloud.account.uid
    const done = async () => {
      if (!owner) await collectSales(state)
      list = await listings(uid)
      loading = false
      refresh()
    }
    void done()
  }

  return {
    title: () => (owner ? `🏪 ${t('market.of', { name: owner.name })}` : `🏪 ${t('market.mine')}`),
    onClose: () => {
      list = null
      composing = null
    },
    render(body, refresh) {
      if (online.status !== 'on') {
        body.append(note(t('online.connecting')))
        return
      }
      if (!list) {
        load(refresh)
        body.append(note(t('online.connecting')))
        return
      }
      body.append(note(owner ? t('market.buyHint') : t('market.ownerHint')))
      const grid = document.createElement('div')
      grid.className = 'stall-grid'
      for (let slot = 0; slot < STALL_SLOTS; slot++) {
        const l = list.find((x) => x.slot === slot)
        const cell = document.createElement('div')
        cell.className = 'stall-slot' + (l?.sold ? ' is-sold' : '')
        if (l) {
          cell.innerHTML = `${itemIconHtml(l.item)}<strong></strong><span class="stall-slot__price"></span>`
          cell.querySelector('strong')!.textContent = `${itemName(l.item)} ×${l.qty}`
          cell.querySelector('.stall-slot__price')!.textContent = l.sold ? t('market.soldTo', { name: l.buyerName ?? '?' }) : `${l.price}g`
          const b = document.createElement('button')
          b.className = owner ? 'btn small gold' : 'btn small'
          b.textContent = owner ? t('market.buy') : t('market.unlist')
          b.disabled = l.sold || (owner !== null && me().gold < l.price)
          b.addEventListener('click', () => {
            b.disabled = true
            const run = owner ? buy(state, owner.uid, l, me().name, visiting, me().gold) : unlist(state, l)
            void Promise.resolve(run).then(() => {
              list = null
              refresh()
            })
          })
          cell.append(b)
        } else if (!owner) {
          const add = document.createElement('button')
          add.className = 'btn small'
          add.textContent = `➕ ${t('market.add')}`
          add.addEventListener('click', () => {
            composing = slot
            pick = null
            refresh()
          })
          cell.append(add)
        } else {
          cell.append(note(t('market.empty')))
        }
        grid.append(cell)
      }
      body.append(grid)

      // Soạn món mới cho ô trống (sạp của mình).
      if (!owner && composing !== null) {
        const slot = composing
        const choices = [...new Set(state.inventory.slots.flatMap((s) => (s && SELLABLE.has(ITEMS.get(s.id)!.kind) ? [s.id] : [])))]
        const pickRow = document.createElement('div')
        pickRow.className = 'gift-pick'
        if (!choices.length) pickRow.textContent = t('friend.nothing')
        for (const id of choices) {
          const b = document.createElement('button')
          b.className = 'slot gift-pick__item' + (pick === id ? ' is-selected' : '')
          b.innerHTML = itemIconHtml(id) + `<span class="count">${countItem(state.inventory, id)}</span>`
          b.title = itemName(id)
          b.addEventListener('click', () => {
            pick = id
            qty = 1
            price = suggest(id, 1)
            refresh()
          })
          pickRow.append(b)
        }
        body.append(pickRow)
        if (pick) {
          const id = pick
          body.append(stepper(t('market.qty'), qty, 1, countItem(state.inventory, id), 1, (n) => {
            qty = n
            price = suggest(id, n)
            refresh()
          }))
          body.append(stepper(t('market.price'), price, 5, 99_999, Math.max(5, Math.round(price / 10 / 5) * 5), (n) => {
            price = n
            refresh()
          }))
          const go = document.createElement('button')
          go.className = 'btn primary'
          go.textContent = t('market.list', { qty, item: itemName(id), price })
          go.addEventListener('click', () => {
            go.disabled = true
            void listItem(state, slot, id, qty, price).then(() => {
              composing = null
              list = null
              refresh()
            })
          })
          body.append(go)
        }
      }
    },
  }
}

/** Giá gợi ý: giá bán ở quầy +20% (bạn bè vẫn lời hơn mua giống tự trồng). */
function suggest(id: string, qty: number): number {
  return Math.max(5, Math.round(((item(id).sellPrice ?? 10) * qty * 1.2) / 5) * 5)
}

function stepper(label: string, value: number, min: number, max: number, step: number, onChange: (n: number) => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'trade-stepper'
  const name = document.createElement('span')
  name.textContent = label
  const minus = document.createElement('button')
  minus.className = 'btn small'
  minus.textContent = '−'
  minus.disabled = value <= min
  minus.addEventListener('click', () => onChange(Math.max(min, value - step)))
  const v = document.createElement('strong')
  v.textContent = String(value)
  const plus = document.createElement('button')
  plus.className = 'btn small'
  plus.textContent = '+'
  plus.disabled = value >= max
  plus.addEventListener('click', () => onChange(Math.min(max, value + step)))
  row.append(name, minus, v, plus)
  return row
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-note'
  p.textContent = text
  return p
}
