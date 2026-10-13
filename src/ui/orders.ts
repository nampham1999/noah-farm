import type { GameState, Order } from '../core/state.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { countItem } from '../systems/inventory.ts'
import { canDeliver, daysLeft, deliver, npcDef } from '../systems/orders.ts'
import { itemIconHtml } from './icons.ts'
import type { PanelSpec } from './panel.ts'

/** Thẻ một đơn hàng: ai đặt, cần gì (có/cần), thưởng, hạn, nút Giao hàng. */
function orderCard(state: GameState, o: Order, refresh: () => void, showWho: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = 'order-card' + (canDeliver(state, o) ? ' is-ready' : '')
  const npc = npcDef(o.npc)

  if (showWho) {
    const who = document.createElement('div')
    who.className = 'order-card__who'
    who.textContent = `${npc.emoji} ${tKey(`npc.${o.npc}`)}`
    card.append(who)
  }

  for (const l of o.lines) {
    const have = countItem(state.inventory, l.itemId)
    const line = document.createElement('div')
    line.className = 'order-line' + (have >= l.qty ? ' is-met' : '')
    line.innerHTML = `<span class="row-icon">${itemIconHtml(l.itemId)}</span><span class="order-line__name"></span><span class="order-line__count"></span>`
    line.querySelector('.order-line__name')!.textContent = itemName(l.itemId)
    line.querySelector('.order-line__count')!.textContent = `${Math.min(have, l.qty)}/${l.qty}`
    card.append(line)
  }

  const days = daysLeft(state, o)
  const foot = document.createElement('div')
  foot.className = 'order-card__foot'
  const reward = document.createElement('span')
  reward.className = 'gold-pill'
  reward.innerHTML = `<span class="coin-dot"></span><span></span>`
  reward.lastElementChild!.textContent = `${o.gold} · +${o.xp} XP${o.bonus ? ` · 🎁 ${o.bonus.qty} ${itemName(o.bonus.itemId)}` : ''}`
  const due = document.createElement('span')
  due.className = 'order-card__due' + (days <= 0 ? ' is-urgent' : '')
  due.textContent = o.rush ? `⚡ ${t('order.rush')}` : days <= 0 ? t('order.today') : t('order.daysLeft', { n: days })
  const btn = document.createElement('button')
  btn.className = 'btn small primary'
  btn.textContent = t('order.deliver')
  btn.disabled = !canDeliver(state, o)
  btn.addEventListener('click', () => deliver(state, o.id) && refresh())
  foot.append(reward, due, btn)
  card.append(foot)
  return card
}

/** Bảng đơn hàng: tất cả đơn đang có. */
export function createBoardPanel(state: GameState): PanelSpec {
  return {
    title: () => `📋 ${t('order.board')}`,
    render(body, refresh) {
      const hint = document.createElement('p')
      hint.className = 'panel__hint'
      hint.textContent = t('order.boardHint')
      body.append(hint)
      if (state.orders.list.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'empty'
        empty.textContent = t('order.none')
        body.append(empty)
      }
      const list = document.createElement('div')
      list.className = 'rows'
      for (const o of state.orders.list) list.append(orderCard(state, o, refresh, true))
      body.append(list)
    },
  }
}

/** Nói chuyện với một dân làng: lời chào hoặc lời nhắn của đơn, kèm thẻ đơn nếu có. */
export function npcDialog(state: GameState, npcId: string): PanelSpec {
  const npc = npcDef(npcId)
  // Chọn sẵn một câu chào cho lần nói chuyện này.
  const greet = 1 + Math.floor(Math.random() * npc.lines)
  return {
    title: () => `${npc.emoji} ${tKey(`npc.${npcId}`)}`,
    render(body, refresh) {
      const order = state.orders.list.find((o) => o.npc === npcId)
      const speech = document.createElement('div')
      speech.className = 'speech'
      const face = document.createElement('span')
      face.className = 'speech__face'
      face.textContent = npc.emoji
      const text = document.createElement('p')
      text.className = 'speech__text'
      if (order) {
        const what = order.lines.map((l) => `${l.qty} ${itemName(l.itemId)}`).join(', ')
        text.textContent = order.scripted ? t('order.firstNote', { what }) : tKey(`npc.${npcId}.ask`, { what })
        if (canDeliver(state, order)) text.textContent += ` ${t('order.readyNote')}`
      } else {
        text.textContent = tKey(`npc.${npcId}.line${greet}`)
      }
      speech.append(face, text)
      body.append(speech)
      if (order) body.append(orderCard(state, order, refresh, false))
    },
  }
}
