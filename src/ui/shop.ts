import type { GameState } from '../core/state.ts'
import { animalData, CROP_BY_ID, item } from '../data/index.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { now } from '../core/time.ts'
import { buyAnimal, buyCoopLevel, coopCapacity } from '../systems/animals.ts'
import { buyLand, nextLandPrice } from '../systems/land.ts'
import { countItem } from '../systems/inventory.ts'
import { buy, seedCatalog, sell, sellableItems, supplyCatalog } from '../systems/shop.ts'
import { itemIconHtml } from './icons.ts'
import type { PanelSpec } from './panel.ts'

type Tab = 'buy' | 'animals' | 'sell'

/** Cửa hàng ở quầy: tab Mua hạt giống và tab Bán nông sản. */
export function createShopPanel(state: GameState): PanelSpec {
  let tab: Tab = 'buy'

  return {
    title: () => t('shop.title'),
    render(body, refresh) {
      const tabs = document.createElement('div')
      tabs.className = 'tabs'
      for (const id of ['buy', 'animals', 'sell'] as const) {
        const b = button(t(`shop.tab.${id}`), 'btn small tab' + (tab === id ? ' is-active' : ''), () => {
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
      else if (tab === 'animals') renderAnimals(list, refresh)
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

  function renderAnimals(list: HTMLElement, refresh: () => void): void {
    const p = state.player
    // Mở rộng ruộng.
    const landPrice = nextLandPrice(state)
    const landRow = iconRow('🌱', t('shop.land'), landPrice === null ? t('shop.landMax', { n: state.plots.length }) : t('shop.landSub', { n: state.plots.length }))
    if (landPrice !== null) landRow.append(button(`${landPrice}g`, 'btn small gold', () => buyLand(state) && refresh(), p.gold < landPrice))
    list.append(landRow)

    // Chuồng: xây mới hoặc nâng cấp.
    const next = animalData.coopLevels[state.coopLevel]
    const coopRow = iconRow('🏠', t(state.coopLevel === 0 ? 'shop.coopBuild' : 'shop.coopUpgrade'),
      next
        ? `${t('shop.capacity', { n: next.capacity })}${p.level < next.level ? ` · ${t('notice.locked', { level: next.level })}` : ''}`
        : t('shop.coopMax', { n: coopCapacity(state) }))
    if (next) {
      if (p.level < next.level) coopRow.classList.add('locked')
      coopRow.append(button(`${next.price}g`, 'btn small gold', () => buyCoopLevel(state) && refresh(), p.level < next.level || p.gold < next.price))
    }
    list.append(coopRow)

    // Vật nuôi.
    const room = coopCapacity(state) - state.animals.length
    for (const def of animalData.animals) {
      const owned = state.animals.filter((a) => a.type === def.id).length
      const locked = p.level < def.level
      const sub = locked
        ? t('notice.locked', { level: def.level })
        : `${t('shop.animalMakes', { item: itemName(def.product), days: def.cycleDays })} · ${t('shop.owned', { n: owned })}`
      const row = iconRow(def.icon, tKey(`animal.${def.id}`), sub)
      if (locked) row.classList.add('locked')
      row.append(button(`${def.price}g`, 'btn small gold', () => buyAnimal(state, def.id, now()) && refresh(), locked || room <= 0 || p.gold < def.price))
      list.append(row)
    }
    const status = document.createElement('p')
    status.className = 'panel__hint'
    status.textContent = state.coopLevel === 0 ? t('animal.needCoop') : t('shop.coopSpace', { used: state.animals.length, n: coopCapacity(state) })
    list.append(status)

    // Cỏ khô.
    for (const entry of supplyCatalog()) {
      const row = shopRow(entry.itemId, itemName(entry.itemId), t('shop.owned', { n: countItem(state.inventory, entry.itemId) }))
      for (const qty of [1, 10]) {
        row.append(button(`${qty > 1 ? `×${qty} · ` : ''}${entry.price * qty}g`, 'btn small gold', () => buy(state, entry, qty) && refresh(), p.gold < entry.price * qty))
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

function iconRow(emoji: string, name: string, sub: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('.emoji')!.textContent = emoji
  row.querySelector('strong')!.textContent = name
  row.querySelector('.muted')!.textContent = sub
  return row
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
