import type { GameState } from '../core/state.ts'
import { RECIPES } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import { countItem } from '../systems/inventory.ts'
import { nextRestaurantLevel, serveGuest, upgradeRestaurant } from '../systems/restaurant.ts'
import type { PanelSpec } from './panel.ts'

/** Nhà hàng ngoài phố: mở và nâng cấp bàn, xem khách đang chờ và mang món ra. */
export function restaurantPanel(state: GameState, now: () => number): PanelSpec {
  return {
    title: () => `🍴 ${t('restaurant.title')}`,
    render(body, refresh) {
      const r = state.restaurant
      const next = nextRestaurantLevel(state)
      const intro = document.createElement('p')
      intro.className = 'panel__hint'
      intro.textContent = r.level === 0 ? t('restaurant.intro') : t('restaurant.stats', { seats: r.level * 2, served: r.served, earned: r.earned, missed: r.missed })
      body.append(intro)

      if (next) {
        const locked = state.player.level < next.level
        const btn = document.createElement('button')
        btn.className = 'btn gold' + (locked ? '' : ' primary')
        btn.disabled = locked || state.player.gold < next.price
        btn.textContent = r.level === 0
          ? t('restaurant.open', { price: next.price })
          : t('restaurant.upgrade', { price: next.price, seats: (r.level + 1) * 2 })
        btn.addEventListener('click', () => upgradeRestaurant(state) && refresh())
        body.append(btn)
        if (locked) {
          const lock = document.createElement('p')
          lock.className = 'panel__hint'
          lock.textContent = t('notice.locked', { level: next.level })
          body.append(lock)
        }
      }

      const list = document.createElement('div')
      list.className = 'rows'
      if (r.level > 0 && !r.guests.length) {
        const none = document.createElement('p')
        none.className = 'panel__hint'
        none.textContent = t('restaurant.noGuests')
        body.append(none)
      }
      for (const g of r.guests) {
        const dish = `food_${g.food}`
        const row = document.createElement('div')
        row.className = 'row'
        row.innerHTML = '<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong><small></small></span>'
        row.querySelector('.emoji')!.textContent = RECIPES.find((x) => x.id === g.food)?.icon ?? '🍽️'
        row.querySelector('strong')!.textContent = itemName(dish)
        const left = Math.max(0, Math.ceil((g.patience - (now() - g.since)) / 1000))
        row.querySelector('small')!.textContent = `${t('restaurant.have', { n: countItem(state.inventory, dish) })} · ⏱ ${left}s`
        const serve = document.createElement('button')
        serve.className = 'btn small primary'
        serve.textContent = t('restaurant.serve')
        serve.disabled = countItem(state.inventory, dish) < 1
        serve.addEventListener('click', () => {
          serveGuest(state, g.id, now())
          refresh()
        })
        row.append(serve)
        list.append(row)
      }
      body.append(list)
    },
  }
}
