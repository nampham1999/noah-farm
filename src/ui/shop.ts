import type { GameState } from '../core/state.ts'
import { animalData, CROP_BY_ID, FRUIT_TREES, FURNITURE, item, MACHINES } from '../data/index.ts'
import { buyFurniture, nextHouseUpgrade, upgradeHouse } from '../systems/house.ts'
import { ROOM_SIZES } from '../core/world.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { now } from '../core/time.ts'
import { buyAnimal, buyCoopLevel, coopCapacity } from '../systems/animals.ts'
import { buyGreenhouse, buyLand, GREENHOUSE_LEVEL, GREENHOUSE_PRICE, nextLandPrice } from '../systems/land.ts'
import { countItem } from '../systems/inventory.ts'
import { buyMachine } from '../systems/machines.ts'
import { buyPet, PET_PRICE } from '../systems/pet.ts'
import { buyHorse, HORSE_LEVEL, HORSE_PRICE } from '../systems/riding.ts'
import { buyCoopFence, COOP_FENCE_PRICE } from '../systems/fox.ts'
import { buy, seedCatalog, sell, sellableItems, supplyCatalog } from '../systems/shop.ts'
import { itemIconHtml } from './icons.ts'
import type { PanelSpec } from './panel.ts'

type Tab = 'buy' | 'animals' | 'furniture' | 'sell'

/** Cửa hàng ở quầy: tab Mua hạt giống và tab Bán nông sản. */
export function createShopPanel(state: GameState): PanelSpec {
  let tab: Tab = 'buy'

  return {
    title: () => t('shop.title'),
    render(body, refresh) {
      const tabs = document.createElement('div')
      tabs.className = 'tabs'
      for (const id of ['buy', 'animals', 'furniture', 'sell'] as const) {
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
      else if (tab === 'furniture') renderFurniture(list, refresh)
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
          : `${crop.seasons.includes(state.clock.season) ? '' : `${t('shop.greenhouseOnly')} · `}${t('shop.grow', { minutes: crop.growMinutes, price: crop.sellPrice })} · ${t('shop.owned', { n: countItem(state.inventory, entry.itemId) })}`,
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

    // Hàng rào bãi thả (chặn cáo đêm).
    if (state.coopLevel > 0) {
      const fenceRow = iconRow('🦊', t('fox.fenceName'), state.coopFence ? t('fox.fenceOwned') : t('fox.fenceSub'))
      if (!state.coopFence) fenceRow.append(button(`${COOP_FENCE_PRICE}g`, 'btn small gold', () => buyCoopFence(state) && refresh(), p.gold < COOP_FENCE_PRICE))
      list.append(fenceRow)
    }

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

    // Cây giống ăn quả (trồng ở các ô vườn có cọc gỗ).
    for (const tree of FRUIT_TREES) {
      const id = `sapling_${tree.id}`
      const locked = p.level < tree.level
      const row = shopRow(id, itemName(id), locked
        ? t('notice.locked', { level: tree.level })
        : t('shop.saplingSub', { a: tKey(`season.${tree.seasons[0]}`), b: tKey(`season.${tree.seasons[1]}`), price: tree.fruitPrice }))
      if (locked) row.classList.add('locked')
      row.append(button(`${tree.saplingPrice}g`, 'btn small gold', () => buy(state, { itemId: id, price: tree.saplingPrice, level: tree.level }, 1) && refresh(), locked || p.gold < tree.saplingPrice))
      list.append(row)
    }

    // Nhà kính.
    const ghRow = iconRow('🪴', t('shop.greenhouse'), state.greenhouse ? t('shop.greenhouseOwned') : p.level < GREENHOUSE_LEVEL ? t('notice.locked', { level: GREENHOUSE_LEVEL }) : t('shop.greenhouseSub'))
    if (!state.greenhouse) {
      if (p.level < GREENHOUSE_LEVEL) ghRow.classList.add('locked')
      ghRow.append(button(`${GREENHOUSE_PRICE}g`, 'btn small gold', () => buyGreenhouse(state) && refresh(), p.level < GREENHOUSE_LEVEL || p.gold < GREENHOUSE_PRICE))
    }
    list.append(ghRow)

    // Nâng cấp nhà.
    const house = nextHouseUpgrade(state)
    const houseRow = iconRow('🏡', t('shop.houseUpgrade', { level: state.house.level + 1 }),
      house
        ? `${t('shop.houseSub', { w: ROOM_SIZES[state.house.level].w, d: ROOM_SIZES[state.house.level].d })}${p.level < house.level ? ` · ${t('notice.locked', { level: house.level })}` : ''}`
        : t('shop.houseMax'))
    if (house) {
      if (p.level < house.level) houseRow.classList.add('locked')
      houseRow.append(button(`${house.price}g`, 'btn small gold', () => upgradeHouse(state) && refresh(), p.level < house.level || p.gold < house.price))
    }
    list.append(houseRow)

    // Ngựa.
    const horseRow = iconRow('🐴', t('horse.shopName'), state.horse ? t('horse.owned') : p.level < HORSE_LEVEL ? t('notice.locked', { level: HORSE_LEVEL }) : t('horse.shopSub'))
    if (!state.horse) {
      if (p.level < HORSE_LEVEL) horseRow.classList.add('locked')
      horseRow.append(button(`${HORSE_PRICE}g`, 'btn small gold', () => buyHorse(state) && refresh(), p.level < HORSE_LEVEL || p.gold < HORSE_PRICE))
    }
    list.append(horseRow)

    // Chó nuôi.
    const petRow = iconRow('🐶', t('pet.shopName'), state.pet ? t('pet.owned', { name: state.pet.name }) : t('pet.shopSub'))
    if (!state.pet) petRow.append(button(`${PET_PRICE}g`, 'btn small gold', () => buyPet(state) && refresh(), p.gold < PET_PRICE))
    list.append(petRow)

    // Máy chế biến (dựng ở góc xưởng cạnh nhà).
    for (const def of MACHINES) {
      const owned = state.machines.some((m) => m.id === def.id)
      const locked = p.level < def.level
      const row = iconRow(def.icon, tKey(`machine.${def.id}`), owned ? t('machine.owned') : locked ? t('notice.locked', { level: def.level }) : tKey(`machine.desc.${def.id}`))
      if (locked) row.classList.add('locked')
      if (!owned) row.append(button(`${def.price}g`, 'btn small gold', () => buyMachine(state, def.id, now()) && refresh(), locked || p.gold < def.price))
      list.append(row)
    }

    // Cỏ khô.
    for (const entry of supplyCatalog()) {
      const row = shopRow(entry.itemId, itemName(entry.itemId), t('shop.owned', { n: countItem(state.inventory, entry.itemId) }))
      for (const qty of [1, 10]) {
        row.append(button(`${qty > 1 ? `×${qty} · ` : ''}${entry.price * qty}g`, 'btn small gold', () => buy(state, entry, qty) && refresh(), p.gold < entry.price * qty))
      }
      list.append(row)
    }
  }

  function renderFurniture(list: HTMLElement, refresh: () => void): void {
    const p = state.player
    const hint = document.createElement('p')
    hint.className = 'panel__hint'
    hint.textContent = t('shop.furnitureHint')
    list.append(hint)
    for (const def of [...FURNITURE].sort((a, b) => a.level - b.level || a.price - b.price)) {
      const id = `furn_${def.id}`
      const locked = p.level < def.level
      const sub = locked
        ? t('notice.locked', { level: def.level })
        : `${def.w}×${def.d} · ${t('shop.owned', { n: countItem(state.inventory, id) + state.house.furniture.filter((f) => f.id === def.id).length })}`
      const row = shopRow(id, itemName(id), sub)
      if (locked) row.classList.add('locked')
      row.append(button(`${def.price}g`, 'btn small gold', () => buyFurniture(state, def.id) && refresh(), locked || p.gold < def.price))
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

export function iconRow(emoji: string, name: string, sub: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('.emoji')!.textContent = emoji
  row.querySelector('strong')!.textContent = name
  row.querySelector('.muted')!.textContent = sub
  return row
}

export function shopRow(itemId: string, name: string, sub: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon">${itemIconHtml(itemId)}</span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('strong')!.textContent = name
  row.querySelector('.muted')!.textContent = sub
  return row
}

export function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}
