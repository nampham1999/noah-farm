import type { GameState } from '../core/state.ts'
import { RECIPES } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import { countItem } from '../systems/inventory.ts'
import {
  dailySpecial, dishPay, ensureKitchen, guestMood, hireWaiter, isRush, nextRestaurantLevel, restaurantStars, serveGuest, STAR_AT, STOCK_MAX, stockDish,
  upgradeRestaurant, WAITER_LEVEL, WAITER_PRICE,
} from '../systems/restaurant.ts'
import { now as clockNow } from '../core/time.ts'
import { collect, machineStatus } from '../systems/machines.ts'
import { machinePanel } from './machines.ts'
import type { PanelSpec } from './panel.ts'

const MOODS = ['😊', '😐', '😠']
const iconOf = (food: string): string => RECIPES.find((r) => r.id === food)?.icon ?? '🍽️'

function text(tag: 'p' | 'h4', cls: string, content: string): HTMLElement {
  const el = document.createElement(tag)
  el.className = cls
  el.textContent = content
  return el
}

function row(icon: string, title: string, sub: string, ...actions: HTMLElement[]): HTMLElement {
  const r = document.createElement('div')
  r.className = 'row'
  r.innerHTML = '<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong><small></small></span>'
  r.querySelector('.emoji')!.textContent = icon
  r.querySelector('strong')!.textContent = title
  r.querySelector('small')!.textContent = sub
  r.append(...actions)
  return r
}

function button(label: string, cls: string, disabled: boolean, on: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = label
  b.disabled = disabled
  b.addEventListener('click', on)
  return b
}

/** Nhà hàng ngoài phố: sao và danh tiếng, món đặc biệt, nâng cấp bàn, thuê nhân viên, kệ trưng bày và khách đang chờ. */
export function restaurantPanel(state: GameState, now: () => number): PanelSpec {
  // Bếp nhà hàng dùng lại cửa sổ máy chế biến (bếp), nhúng vào bảng nhà hàng.
  const kitchen = machinePanel(state, 'stove')
  return {
    title: () => `🍴 ${t('restaurant.title')}`,
    onClose: () => kitchen.onClose?.(),
    render(body, refresh) {
      const r = state.restaurant
      ensureKitchen(state)
      const stars = restaurantStars(state)
      const next = nextRestaurantLevel(state)

      if (r.level === 0) body.append(text('p', 'panel__hint', t('restaurant.intro')))
      else {
        const toNext = STAR_AT[stars - 1]
        body.append(
          text('h4', 'panel__hint', `${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)} · ${toNext ? t('restaurant.repNext', { rep: r.rep, next: toNext }) : t('restaurant.repMax', { rep: r.rep })}`),
          text('p', 'panel__hint', t('restaurant.stats', { seats: r.level * 2, served: r.served, earned: r.earned, missed: r.missed })),
        )
        const special = dailySpecial(state)
        body.append(text('p', 'panel__hint', `⭐ ${t('restaurant.special', { dish: itemName(`food_${special}`) })}${isRush(state) ? ` · 🔥 ${t('restaurant.rush')}` : ''}`))
      }

      if (next) {
        const locked = state.player.level < next.level
        body.append(
          button(r.level === 0 ? t('restaurant.open', { price: next.price }) : t('restaurant.upgrade', { price: next.price, seats: (r.level + 1) * 2 }), 'btn gold' + (locked ? '' : ' primary'), locked || state.player.gold < next.price, () => upgradeRestaurant(state) && refresh()),
        )
        if (locked) body.append(text('p', 'panel__hint', t('notice.locked', { level: next.level })))
      }

      if (r.level > 0 && !r.waiter) {
        const locked = state.player.level < WAITER_LEVEL
        body.append(button(t('restaurant.hire', { price: WAITER_PRICE }), 'btn gold', locked || state.player.gold < WAITER_PRICE, () => hireWaiter(state) && refresh()))
        body.append(text('p', 'panel__hint', locked ? t('notice.locked', { level: WAITER_LEVEL }) : t('restaurant.hireHint')))
      }

      // Bếp nhà hàng: nấu ngay tại chỗ, xong thì lấy món ra túi.
      if (r.level > 0) {
        body.append(text('h4', 'panel__hint', `🍳 ${t('restaurant.kitchen')}`))
        const box = document.createElement('div')
        box.className = 'restaurant-kitchen'
        if (machineStatus(state, 'stove', clockNow()) === 'ready') {
          const out = state.machines.find((m) => m.id === 'stove')?.output
          box.append(row(out ? '🍽️' : '✅', out ? itemName(out) : t('restaurant.kitchenReady'), t('restaurant.kitchenReadySub'),
            button(t('restaurant.collect'), 'btn small primary', false, () => (collect(state, 'stove', clockNow()), refresh()))))
        } else kitchen.render(box, refresh)
        body.append(box)
      }

      // Kệ trưng bày: cất món trong túi lên kệ để nhân viên phục vụ tự mang ra.
      if (r.waiter) {
        body.append(text('h4', 'panel__hint', `🧑‍🍳 ${t('restaurant.shelf')}`))
        const shelf = document.createElement('div')
        shelf.className = 'rows'
        const dishes = RECIPES.filter((x) => countItem(state.inventory, `food_${x.id}`) > 0 || (r.stock[x.id] ?? 0) > 0)
        for (const d of dishes) {
          const have = countItem(state.inventory, `food_${d.id}`)
          const onShelf = r.stock[d.id] ?? 0
          shelf.append(row(d.icon, itemName(`food_${d.id}`), t('restaurant.shelfSub', { bag: have, shelf: onShelf, max: STOCK_MAX }),
            button('+1', 'btn small', have < 1 || onShelf >= STOCK_MAX, () => (stockDish(state, d.id, 1), refresh())),
            button('+5', 'btn small', have < 1 || onShelf >= STOCK_MAX, () => (stockDish(state, d.id, 5), refresh()))))
        }
        if (!dishes.length) shelf.append(text('p', 'panel__hint', t('restaurant.shelfEmpty')))
        body.append(shelf)
      }

      if (r.level > 0) {
        body.append(text('h4', 'panel__hint', `🍽️ ${t('restaurant.guests')}`))
        if (!r.guests.length) body.append(text('p', 'panel__hint', t('restaurant.noGuests')))
      }
      const list = document.createElement('div')
      list.className = 'rows'
      for (const g of r.guests) {
        const left = Math.max(0, Math.ceil((g.patience - (now() - g.since)) / 1000))
        const first = g.foods.find((f) => countItem(state.inventory, `food_${f}`) > 0)
        const title = `${g.kind === 'vip' ? '👑 ' : g.kind === 'family' ? '👨‍👩‍👧 ' : ''}${g.foods.map((f) => `${iconOf(f)} ${itemName(`food_${f}`)}`).join(' + ')}`
        const sub = `${MOODS[guestMood(g, now())]} ⏱ ${left}s · ${t('restaurant.pays', { gold: dishPay(state, g, g.foods[0]) })}${g.special && g.foods[0] === dailySpecial(state) ? ' · ⭐' : ''}`
        list.append(row(iconOf(g.foods[0]), title, sub, button(t('restaurant.serve'), 'btn small primary', !first, () => (serveGuest(state, g.id, now()), refresh()))))
      }
      body.append(list)
    },
  }
}
