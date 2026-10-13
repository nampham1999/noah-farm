import { bus, type GameAction } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { balance, xpToNext } from '../data/index.ts'
import { getLang, itemName, noticeText, t, tKey } from '../i18n/index.ts'
import { dayPhase, type DayPhase } from '../systems/clock.ts'
import { itemIconHtml } from './icons.ts'
import { slotElement } from './inventory.ts'

export interface HudHooks {
  eat(): void
  openInventory(): void
  openMenu(): void
  /** Có cần nhắc sao lưu không (hiện chấm đỏ trên nút menu). */
  backupDue(): boolean
  /** Nút cưỡi: hiện khi đứng gần bò đã thuần hoặc đang cưỡi (GDD mục 4). */
  rideState(): 'none' | 'can' | 'riding'
}

export interface Hud {
  /** Gọi mỗi khung hình; chỉ chạm vào DOM khi có thay đổi. */
  update(fps: number, pixelRatio: number): void
}

const TOAST_MS = 2600
const MAX_TOASTS = 3
const TOUCH_HINT_MS = 12_000

/**
 * HUD theo bố cục bản cũ (cozyfarmy.com) và GDD mục 4:
 * trên trái avatar có vòng XP và thể lực; trên phải vàng, đồng hồ, menu;
 * dưới giữa thanh công cụ gỗ có ô túi đồ; dưới phải nút Tương tác và nút Dùng.
 */
export function createHud(ui: HTMLElement, state: GameState, hooks: HudHooks): Hud {
  const hud = el('div', 'hud')

  // Trên trái: avatar với vòng XP chạy quanh, huy hiệu cấp; thanh thể lực bên cạnh.
  const top = el('div', 'hud-top')
  const avatar = el('button', 'avatar')
  const face = el('span', 'avatar__face', '🧑‍🌾')
  const level = el('span', 'avatar__lvl')
  avatar.append(face, level)
  avatar.addEventListener('click', hooks.openInventory)
  const energy = el('button', 'energy-pill')
  const energyFill = el('span', 'energy-pill__fill')
  const energyText = el('span', 'energy-pill__text')
  energy.append(el('span', 'energy-pill__ico', '⚡'), el('span', 'energy-pill__bar', energyFill), energyText)
  energy.addEventListener('click', hooks.eat)
  const left = el('div', 'hud-left', avatar, energy)

  // Trên phải: vàng, đồng hồ, menu.
  const goldText = el('span', 'res-pill__num')
  const gold = el('div', 'res-pill', el('span', 'coin-dot big'), goldText)
  const clockTime = el('span', 'clock-card__time')
  const clockDate = el('span', 'clock-card__date')
  const clockIco = el('span', 'clock-card__ico', '☀️')
  const clock = el('div', 'clock-card', clockIco, el('span', 'clock-card__text', clockTime, clockDate))
  const menuBtn = el('button', 'round-btn', '☰')
  menuBtn.addEventListener('click', hooks.openMenu)
  top.append(left, el('div', 'hud-right', gold, clock, menuBtn))

  // Dưới giữa: tên vật phẩm đang cầm, thanh công cụ, gợi ý điều khiển.
  const heldName = el('div', 'held-name')
  const hotbar = el('div', 'hotbar')
  const hint = el('div', 'controls-hint')
  const bottom = el('div', 'hud-bottom', heldName, hotbar, hint)
  setTimeout(() => hint.classList.add('is-faded'), TOUCH_HINT_MS)

  const bagSlot = el('button', 'slot bag-slot', el('span', 'icon', el('span', 'emoji', '🎒')))
  bagSlot.addEventListener('click', hooks.openInventory)

  // Dưới phải: nút Tương tác và nút Dùng (hiện icon vật đang cầm), như bản cũ.
  const interactBtn = actionButton('act-btn', 'interact', '✋')
  const useBtn = actionButton('act-btn big', 'useTool', '✋')
  const rideBtn = actionButton('act-btn', 'ride', '🐮')
  rideBtn.hidden = true
  const actions = el('div', 'hud-actions', rideBtn, interactBtn, useBtn)

  const toasts = el('div', 'toasts')

  // Thêm ?debug vào URL để xem FPS và độ phân giải render.
  const debug = new URLSearchParams(location.search).has('debug')
  const stats = el('div', 'hud-stats')
  stats.hidden = !debug

  hud.append(top, bottom, actions, toasts)
  ui.append(hud, stats)

  const showToast = (text: string, good = false) => {
    const toast = el('div', good ? 'toast toast--good' : 'toast', text)
    toasts.append(toast)
    while (toasts.childElementCount > MAX_TOASTS) toasts.firstElementChild!.remove()
    setTimeout(() => toast.remove(), TOAST_MS)
  }
  bus.on('notify', (n) => showToast(noticeText(n.key, n.params), n.good))
  bus.on('levelUp', () => avatar.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], 500))

  // Mỗi phần chỉ vẽ lại khi chuỗi mô tả nó đổi.
  const last: Record<string, string> = {}
  const changed = (key: string, value: string) => {
    if (last[key] === value) return false
    last[key] = value
    return true
  }

  const drawHotbar = () => {
    const slots = state.inventory.slots.slice(0, balance.toolbarSize).map((stack, i) => {
      const slot = slotElement(stack)
      if (i === state.inventory.selected) slot.classList.add('selected')
      slot.append(el('span', 'key', String(i + 1)))
      slot.addEventListener('mousedown', (e) => e.preventDefault())
      slot.addEventListener('click', () => bus.emit('selectSlot', i + 1))
      return slot
    })
    hotbar.replaceChildren(...slots, bagSlot)
    const held = state.inventory.slots[state.inventory.selected]
    heldName.textContent = held ? itemName(held.id) : t('hud.emptyHand')
    useBtn.innerHTML = held ? itemIconHtml(held.id) : `<span class="icon"><span class="emoji">✋</span></span>`
  }

  const relabel = () => {
    hint.textContent = document.body.classList.contains('is-touch') ? t('hint.touch') : t('hint.desktop')
    avatar.title = t('action.inventory')
    bagSlot.title = t('action.inventory')
    menuBtn.title = t('action.menu')
    energy.title = t('hud.stamina')
    interactBtn.title = t('action.interact')
    useBtn.title = t('action.useTool')
    for (const key of Object.keys(last)) delete last[key]
  }
  relabel()
  bus.on('langChanged', relabel)

  return {
    update(fps, pixelRatio) {
      const p = state.player
      const need = xpToNext(p.level)
      if (changed('xp', `${p.level}|${p.xp}/${need}`)) {
        avatar.style.setProperty('--xp', `${Math.min(100, (p.xp / need) * 100)}%`)
        level.textContent = String(p.level)
        avatar.setAttribute('aria-label', `${t('hud.level', { n: p.level })} · ${p.xp}/${need} XP`)
      }
      if (changed('stamina', `${Math.round(p.stamina)}`)) {
        energyFill.style.width = `${(p.stamina / balance.staminaMax) * 100}%`
        energyText.textContent = String(Math.round(p.stamina))
        energy.classList.toggle('is-low', p.stamina < balance.staminaMax * 0.2)
      }
      if (changed('gold', `${p.gold}`)) goldText.textContent = p.gold.toLocaleString('en-US')

      const c = state.clock
      // Đồng hồ nhảy theo bước 10 phút trong game như bản cũ, đỡ phải vẽ lại mỗi khung hình.
      const shownMinute = Math.floor(c.minuteOfDay / 10) * 10
      if (changed('clock', `${shownMinute}|${c.season}|${c.day}|${getLang()}`)) {
        clockTime.textContent = formatClock(shownMinute)
        clockIco.textContent = PHASE_ICON[dayPhase(c.minuteOfDay)]
        clockDate.textContent = t('hud.date', { day: c.day, season: tKey(`season.${c.season}`) })
      }

      const bar = state.inventory.slots.slice(0, balance.toolbarSize).map((s) => (s ? `${s.id}:${s.qty}` : '-'))
      if (changed('hotbar', `${state.inventory.selected}|${bar.join(',')}`)) drawHotbar()
      const ride = hooks.rideState()
      if (changed('ride', ride)) {
        rideBtn.hidden = ride === 'none'
        rideBtn.classList.toggle('is-on', ride === 'riding')
        rideBtn.title = t(ride === 'riding' ? 'ride.off' : 'ride.on')
      }
      if (changed('badge', `${hooks.backupDue()}`)) menuBtn.classList.toggle('has-badge', hooks.backupDue())
      const touch = document.body.classList.contains('is-touch')
      if (changed('touch', `${touch}`)) {
        hint.textContent = touch ? t('hint.touch') : t('hint.desktop')
        // Màn hình điện thoại ngang không đủ chỗ cho dòng gợi ý: báo một lần như bản cũ.
        if (touch) showToast(`👆 ${t('hint.touch')}`)
      }

      if (debug && changed('stats', `${fps.toFixed(0)}|${pixelRatio}`)) {
        stats.textContent = `${fps.toFixed(0)} FPS · ×${pixelRatio.toFixed(2)}`
      }
    },
  }
}

const PHASE_ICON: Record<DayPhase, string> = { dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙' }

/** Giờ trong game dạng 6:10 SA / 6:10 AM. */
function formatClock(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24
  const m = Math.floor(minuteOfDay % 60)
  const h12 = h24 % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${t(h24 < 12 ? 'time.am' : 'time.pm')}`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children)
  if (node instanceof HTMLButtonElement) {
    // Không giữ focus, nếu không Space (dùng công cụ) sẽ bấm lại nút này.
    node.addEventListener('mousedown', (e) => e.preventDefault())
  }
  return node
}

function actionButton(className: string, action: GameAction, emoji: string): HTMLButtonElement {
  const b = el('button', className)
  b.innerHTML = `<span class="icon"><span class="emoji">${emoji}</span></span>`
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    bus.emit('action', action)
  })
  return b
}
