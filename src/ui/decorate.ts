import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { itemName, t } from '../i18n/index.ts'
import type { Ghost } from '../render/house.ts'
import { canPlace, furnitureAt, place, pickUp } from '../systems/house.ts'
import { countItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'

export interface DecorUi {
  readonly active: boolean
  readonly ghost: Ghost | null
  toggle(): void
  close(): void
  /** Chạm vào ô sàn khi đang trang trí: đặt món đang chọn, hoặc cất món ở ô đó. */
  tapCell(cx: number, cz: number): void
  /** Chuột rê trên sàn: bóng mờ đi theo. */
  hoverCell(cx: number, cz: number): void
  update(): void
}

/** Chế độ trang trí trong nhà (GDD mục 3.5): khay đồ nội thất trong túi, xoay 90°, đặt theo lưới. */
export function createDecorUi(ui: HTMLElement, state: GameState): DecorUi {
  let active = false
  let selected: string | null = null
  let rot = 0
  let cell = { cx: 3, cz: 2 }

  const tray = document.createElement('div')
  tray.className = 'decor-tray'
  tray.hidden = true
  const head = document.createElement('div')
  head.className = 'decor-tray__head'
  const title = document.createElement('strong')
  const hint = document.createElement('span')
  hint.className = 'decor-tray__hint'
  const rotBtn = document.createElement('button')
  rotBtn.className = 'btn small'
  rotBtn.textContent = '⟳'
  const doneBtn = document.createElement('button')
  doneBtn.className = 'btn small primary'
  doneBtn.textContent = '✓'
  head.append(title, hint, rotBtn, doneBtn)
  const list = document.createElement('div')
  list.className = 'decor-tray__list'
  tray.append(head, list)
  ui.append(tray)

  for (const b of [rotBtn, doneBtn]) b.addEventListener('mousedown', (e) => e.preventDefault())
  rotBtn.addEventListener('click', () => (rot = (rot + 1) % 4))
  doneBtn.addEventListener('click', () => api.close())

  let drawn = ''
  const draw = () => {
    const owned = state.inventory.slots.flatMap((s) => (s && s.id.startsWith('furn_') ? [s.id] : []))
    const ids = [...new Set(owned)]
    const key = `${ids.map((id) => `${id}:${countItem(state.inventory, id)}`).join(',')}|${selected}`
    if (key === drawn) return
    drawn = key
    if (selected && !ids.includes(`furn_${selected}`)) selected = null
    list.replaceChildren(
      ...ids.map((id) => {
        const b = document.createElement('button')
        b.className = 'slot' + (selected === id.slice(5) ? ' selected' : '')
        b.title = itemName(id)
        b.innerHTML = itemIconHtml(id)
        const qty = countItem(state.inventory, id)
        if (qty > 1) {
          const q = document.createElement('span')
          q.className = 'qty'
          q.textContent = String(qty)
          b.append(q)
        }
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', () => {
          selected = selected === id.slice(5) ? null : id.slice(5)
          drawn = ''
          draw()
        })
        return b
      }),
    )
    if (ids.length === 0) {
      const empty = document.createElement('span')
      empty.className = 'decor-tray__empty'
      empty.textContent = t('decor.empty')
      list.append(empty)
    }
    hint.textContent = selected ? t('decor.placeHint', { item: itemName(`furn_${selected}`) }) : t('decor.pickHint')
  }

  const api: DecorUi = {
    get active() {
      return active
    },
    get ghost() {
      return selected ? { id: selected, cx: cell.cx, cz: cell.cz, rot } : null
    },
    toggle() {
      if (active) api.close()
      else {
        active = true
        document.body.classList.add('is-decorating')
        tray.hidden = false
        title.textContent = `🛋️ ${t('decor.title')}`
        drawn = ''
      }
    },
    close() {
      active = false
      selected = null
      document.body.classList.remove('is-decorating')
      tray.hidden = true
    },
    tapCell(cx, cz) {
      cell = { cx, cz }
      if (selected) {
        if (!canPlace(state, selected, cx, cz, rot)) return void bus.emit('notify', { key: 'decor.cantPlace' })
        place(state, selected, cx, cz, rot)
        drawn = ''
        return
      }
      const i = furnitureAt(state, cx, cz)
      if (i >= 0) {
        const id = state.house.furniture[i].id
        if (pickUp(state, i)) bus.emit('notify', { key: 'decor.pickedUp', params: { item: `furn_${id}` } })
        drawn = ''
      }
    },
    hoverCell(cx, cz) {
      cell = { cx, cz }
    },
    update() {
      if (!active) return
      if (!state.player.indoors) return api.close()
      draw()
    },
  }
  return api
}
