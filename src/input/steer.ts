/**
 * Ấn giữ rồi kéo để đi, theo cách điều khiển của bản cũ (cozyfarmy.com):
 * ấn ở đâu thì joystick hiện ở đó; kéo quá ngưỡng mới tính là đi, nhả ra mà
 * chưa kéo thì là chạm. Kéo quá bán kính thì tâm joystick trượt theo ngón tay.
 */
export interface SteerConfig {
  /** Kéo quá bao nhiêu px thì tính là đi, không còn là chạm. */
  drag: number
  /** Vùng chết quanh tâm, trong vùng này không đi. */
  dead: number
  /** Bán kính joystick. */
  radius: number
}

export const STEER_DEFAULTS: SteerConfig = { drag: 12, dead: 8, radius: 56 }

export interface SteerMove {
  dragging: boolean
  /** Tâm joystick trên màn hình; null khi chưa kéo. */
  origin: { x: number; y: number } | null
  /** Vị trí núm so với tâm (px). */
  knob: { x: number; y: number } | null
  /** Hướng đi trên màn hình, độ dài 1 (y dương là xuống dưới); null trong vùng chết. */
  steer: { x: number; y: number } | null
}

export interface Steer {
  /** Ấn xuống; trả về false nếu đã có một ngón đang giữ (ngón thứ hai huỷ joystick). */
  down(id: number, x: number, y: number): boolean
  move(id: number, x: number, y: number): SteerMove
  /** Nhả ra: 'tap' nếu chưa kéo, 'drag' nếu đã kéo, null nếu không phải ngón đang giữ. */
  up(id: number): 'tap' | 'drag' | null
  cancel(): void
  active(): boolean
  /** Điểm ấn xuống ban đầu. */
  start(): { x: number; y: number } | null
}

export function createSteer(config: SteerConfig = STEER_DEFAULTS): Steer {
  let s: { id: number; x0: number; y0: number; ox: number; oy: number; dragging: boolean } | null = null
  const none = (): SteerMove => ({ dragging: !!s?.dragging, origin: s?.dragging ? { x: s.ox, y: s.oy } : null, knob: null, steer: null })

  return {
    down(id, x, y) {
      if (s) {
        s = null
        return false
      }
      s = { id, x0: x, y0: y, ox: x, oy: y, dragging: false }
      return true
    },
    move(id, x, y) {
      if (!s || s.id !== id) return none()
      if (!s.dragging) {
        if (Math.hypot(x - s.x0, y - s.y0) < config.drag) return none()
        s.dragging = true
      }
      let dx = x - s.ox
      let dy = y - s.oy
      const d = Math.hypot(dx, dy)
      if (d > config.radius) {
        s.ox += (dx / d) * (d - config.radius)
        s.oy += (dy / d) * (d - config.radius)
        dx = x - s.ox
        dy = y - s.oy
      }
      const len = Math.hypot(dx, dy)
      return {
        dragging: true,
        origin: { x: s.ox, y: s.oy },
        knob: { x: dx, y: dy },
        steer: len < config.dead ? null : { x: dx / len, y: dy / len },
      }
    },
    up(id) {
      if (!s || s.id !== id) return null
      const result = s.dragging ? 'drag' : 'tap'
      s = null
      return result
    },
    cancel() {
      s = null
    },
    active: () => s !== null,
    start: () => (s ? { x: s.x0, y: s.y0 } : null),
  }
}
