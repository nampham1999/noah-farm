import { bus } from '../core/events.ts'
import type { Input } from './input.ts'
import { createSteer } from './steer.ts'

/** Mỗi đơn vị deltaY của bánh xe chuột đổi zoom chừng này (theo hàm mũ, mượt). */
const WHEEL_ZOOM_SPEED = 0.004

/**
 * Chuột và cảm ứng trên canvas, cùng một kiểu điều khiển như bản cũ:
 * - Ấn giữ rồi kéo ở bất kỳ đâu để đi (joystick nổi hiện ở chỗ ấn).
 * - Chạm hoặc click nhanh để dùng lên chỗ đó.
 * - Hai ngón: chụm để zoom. Chuột: lăn để zoom, Shift + lăn để đổi ô công cụ.
 * - Rê chuột thì tô sáng ô dưới con trỏ.
 */
export function attachPointer(input: Input, canvas: HTMLCanvasElement, ui: HTMLElement): void {
  const steer = createSteer()

  const base = document.createElement('div')
  base.className = 'joystick'
  const knob = document.createElement('div')
  knob.className = 'joystick__knob'
  base.append(knob)
  ui.append(base)

  // Lần đầu chạm màn hình thì bật giao diện cảm ứng, kể cả trên laptop màn cảm ứng.
  const enableTouchUi = () => document.body.classList.add('is-touch')
  if (matchMedia('(pointer: coarse)').matches) enableTouchUi()

  const stopSteer = () => {
    input.joystick.x = 0
    input.joystick.y = 0
    base.classList.remove('is-active')
  }

  // Các ngón đang chạm, để nhận chụm hai ngón.
  const touches = new Map<number, { x: number; y: number }>()
  let pinchDist = 0
  const pinchDistance = () => {
    const [a, b] = [...touches.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch'
    if (touch) {
      enableTouchUi()
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) pinchDist = pinchDistance()
    } else if (e.button !== 0) {
      return
    }
    // Ngón thứ hai: huỷ joystick, chuyển sang chụm để zoom.
    if (!steer.down(e.pointerId, e.clientX, e.clientY)) return stopSteer()
    input.hover = null
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Một số trình duyệt không cho bắt con trỏ; vẫn chơi được.
    }
  })

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !steer.active()) {
      input.hover = { x: e.clientX, y: e.clientY, at: performance.now() }
      return
    }

    const t = touches.get(e.pointerId)
    if (t) {
      t.x = e.clientX
      t.y = e.clientY
      if (touches.size === 2 && pinchDist > 0) {
        const d = pinchDistance()
        input.zoomScale *= pinchDist / d
        pinchDist = d
        return
      }
    }

    const m = steer.move(e.pointerId, e.clientX, e.clientY)
    if (!m.dragging || !m.origin || !m.knob) return
    base.classList.add('is-active')
    base.style.left = `${m.origin.x}px`
    base.style.top = `${m.origin.y}px`
    knob.style.transform = `translate(${m.knob.x}px, ${m.knob.y}px)`
    // Màn hình: y dương là xuống dưới; joystick: y dương là đi tới.
    input.joystick.x = m.steer?.x ?? 0
    input.joystick.y = m.steer ? -m.steer.y : 0
  })

  const release = (e: PointerEvent) => {
    touches.delete(e.pointerId)
    if (touches.size < 2) pinchDist = 0
    const start = steer.start()
    const result = steer.up(e.pointerId)
    if (result === 'drag') stopSteer()
    // Dùng chỗ ấn xuống làm chỗ chạm, như bản cũ.
    if (result === 'tap' && e.type === 'pointerup' && start) bus.emit('tap', start)
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') input.hover = null
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.deltaY === 0) return
      // Lăn chuột (và chụm trên touchpad) để zoom; Shift + lăn để đổi ô công cụ.
      if (e.shiftKey) bus.emit('cycleSlot', Math.sign(e.deltaY || e.deltaX))
      else input.zoomScale *= Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * WHEEL_ZOOM_SPEED)
    },
    { passive: false },
  )

  // Chặn cử chỉ phóng to trang của Safari.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
  }
}
