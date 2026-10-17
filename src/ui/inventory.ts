import type { GameState, ItemStack } from '../core/state.ts'
import { balance } from '../data/index.ts'
import { itemName, t } from '../i18n/index.ts'
import { itemIconHtml } from './icons.ts'
import { buyBagUpgrade, nextBagUpgrade } from '../systems/inventory.ts'
import type { PanelSpec } from './panel.ts'

/** Vẽ một ô vật phẩm; dùng chung cho túi đồ và thanh công cụ. */
export function slotElement(stack: ItemStack | null, className = 'slot'): HTMLButtonElement {
  const el = document.createElement('button')
  el.className = className
  if (stack) {
    el.title = itemName(stack.id)
    el.innerHTML = itemIconHtml(stack.id)
    if (stack.qty > 1) {
      const qty = document.createElement('span')
      qty.className = 'qty'
      qty.textContent = String(stack.qty)
      el.append(qty)
    }
  }
  return el
}

/** Túi đồ: lưới các ô, chạm hai ô để đổi chỗ. */
export function createInventoryPanel(state: GameState): PanelSpec {
  let picked: number | null = null

  return {
    title: () => t('inventory.title'),
    render(body, refresh) {
      const grid = document.createElement('div')
      grid.className = 'inv-grid'
      grid.style.setProperty('--toolbar', String(balance.toolbarSize))
      state.inventory.slots.forEach((stack, i) => {
        const el = slotElement(stack)
        if (i < balance.toolbarSize) el.classList.add('slot--toolbar')
        if (i === picked) el.classList.add('picked')
        el.addEventListener('click', () => {
          if (picked === null) {
            if (stack) picked = i
          } else {
            const slots = state.inventory.slots
            ;[slots[picked], slots[i]] = [slots[i], slots[picked]]
            picked = null
          }
          refresh()
        })
        grid.append(el)
      })

      const hint = document.createElement('p')
      hint.className = 'panel__hint'
      hint.textContent = picked !== null && state.inventory.slots[picked]
        ? itemName(state.inventory.slots[picked]!.id)
        : t('inventory.hint')
      body.append(grid, hint)

      // Mở rộng túi: thêm ô trống, mở dần theo cấp.
      const used = state.inventory.slots.filter(Boolean).length
      const cap = document.createElement('p')
      cap.className = 'panel__hint'
      cap.textContent = t('inventory.capacity', { used, total: state.inventory.slots.length })
      body.append(cap)
      const up = nextBagUpgrade(state)
      if (up) {
        const b = document.createElement('button')
        b.className = 'btn' + (state.player.gold >= up.price && state.player.level >= up.level ? ' primary' : '')
        b.textContent = state.player.level < up.level
          ? `🎒 ${t('inventory.expandLocked', { slots: up.slots, level: up.level })}`
          : `🎒 ${t('inventory.expand', { slots: up.slots, price: up.price })}`
        b.addEventListener('click', () => {
          buyBagUpgrade(state)
          refresh()
        })
        body.append(b)
      } else {
        const full = document.createElement('p')
        full.className = 'panel__hint'
        full.textContent = `🎒 ${t('inventory.maxed')}`
        body.append(full)
      }
    },
  }
}
