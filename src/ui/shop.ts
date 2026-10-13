import type { GameState } from '../core/state.ts'
import { CROP_BY_ID, item } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import { countItem } from '../systems/inventory.ts'
import { buy, seedCatalog, sell, sellableItems } from '../systems/shop.ts'
import { itemIconHtml } from './icons.ts'
import type { PanelSpec } from './panel.ts'

type Tab = 'buy' | 'sell'

/** Cửa hàng ở quầy: tab Mua hạt giống và tab Bán nông sản. */
export function createShopPanel(state: GameState): PanelSpec {
  let tab: Tab = 'buy'

  return {
    title: () => t('shop.title'),
    render(body, refresh) {
      const tabs = document.createElement('div')
      tabs.className = 'tabs'
      for (const id of ['buy', 'sell'] as const) {
        const b = button(t(id === 'buy' ? 'shop.buy' : 'shop.sell'), 'btn small tab' + (tab === id ? ' is-active' : ''), () => {
          tab = id
          refresh()
        })
        tabs.append(b)
      }
      const gold = document.createElement('span')
      gold.className = 'gold-pill tabs__gold'
      gold.innerHTML = `<span class="coin-dot"></span><span></span>`
      gold.lastElementChild!.textContent = state.player.gold.toLocaleString('en-US')
      tabs.append(gold)

      const list = document.createElement('div')
      list.className = 'rows'
      if (tab === 'buy') renderBuy(list, refresh)
      else renderSell(list, refresh)
      body.append(tabs, list)
    },
  }

  function renderBuy(list: HTMLElement, refresh: () => void): void {
    for (const entry of seedCatalog(state)) {
      const crop = CROP_BY_ID.get(item(entry.itemId).cropId!)!
      const locked = entry.level > state.player.level
      const row = shopRow(
        entry.itemId,
        itemName(entry.itemId),
        locked
          ? t('notice.locked', { level: entry.level })
          : `${t('shop.grow', { minutes: crop.growMinutes, price: crop.sellPrice })} · ${t('shop.owned', { n: countItem(state.inventory, entry.itemId) })}`,
      )
      if (locked) row.classList.add('locked')
      for (const qty of [1, 5]) {
        row.append(
          button(`${qty > 1 ? `×${qty} · ` : ''}${entry.price * qty}g`, 'btn small gold', () => {
            if (buy(state, entry, qty)) refresh()
          }, locked || state.player.gold < entry.price * qty),
        )
      }
      list.append(row)
    }
  }

  function renderSell(list: HTMLElement, refresh: () => void): void {
    const items = sellableItems(state)
    if (items.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = t('shop.nothingToSell')
      list.append(empty)
      return
    }
    for (const { itemId, qty, price } of items) {
      const row = shopRow(itemId, `${itemName(itemId)} ×${qty}`, `${price}g`)
      row.append(
        button(`${t('shop.sell')} 1`, 'btn small', () => sell(state, itemId, 1) && refresh()),
        button(`${t('shop.sellAll')} · ${price * qty}g`, 'btn small primary', () => sell(state, itemId, qty) && refresh()),
      )
      list.append(row)
    }
  }
}

function shopRow(itemId: string, name: string, sub: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon">${itemIconHtml(itemId)}</span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('strong')!.textContent = name
  row.querySelector('.muted')!.textContent = sub
  return row
}

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}
