import { bus, type GameAction } from '../core/events.ts'
import type { Input } from './input.ts'

const ACTION_KEYS: Record<string, GameAction> = {
  Space: 'useTool',
  KeyE: 'interact',
  KeyR: 'ride',
  KeyF: 'eat',
  KeyI: 'inventory',
  Tab: 'inventory',
  KeyJ: 'journal',
  Escape: 'menu',
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

/** Phím + / − để zoom, như bản cũ. */
const ZOOM_KEYS: Record<string, number> = {
  Equal: 1 / 1.15,
  NumpadAdd: 1 / 1.15,
  Minus: 1.15,
  NumpadSubtract: 1.15,
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/** Bàn phím (GDD mục 4). Chuột và cảm ứng nằm ở pointer.ts. */
export function attachKeyboard(input: Input): void {
  window.addEventListener('keydown', (e) => {
    // Đang gõ chữ (ô dán mã sao lưu...) thì để phím cho ô nhập, trừ Esc để đóng cửa sổ.
    if (isTyping(e.target) && e.code !== 'Escape') return
    if (MOVE_KEYS.has(e.code)) {
      input.keys.add(e.code)
      e.preventDefault()
      return
    }
    const zoom = ZOOM_KEYS[e.code]
    if (zoom) {
      input.zoomScale *= zoom
      e.preventDefault()
      return
    }
    if (e.repeat) return
    const action = ACTION_KEYS[e.code]
    if (action) {
      bus.emit('action', action)
      e.preventDefault()
      return
    }
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) bus.emit('selectSlot', Number(digit[1]))
  })

  window.addEventListener('keyup', (e) => input.keys.delete(e.code))
  // Mất focus thì thả hết phím, tránh nhân vật tự đi mãi.
  window.addEventListener('blur', () => input.keys.clear())
}
