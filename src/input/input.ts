/**
 * Trạng thái input gộp từ bàn phím, chuột và cảm ứng.
 * Lõi game chỉ đọc đối tượng này, không cần biết nguồn input là gì.
 */
export class Input {
  /** Mã phím đang giữ (KeyboardEvent.code). */
  readonly keys = new Set<string>()
  /** Joystick nổi (ấn giữ rồi kéo), mỗi trục trong khoảng -1..1; y dương là đi tới. */
  readonly joystick = { x: 0, y: 0 }
  /** Hệ số zoom tích luỹ trong khung hình; lớn hơn 1 là kéo camera ra xa. */
  zoomScale = 1
  /** Vị trí chuột đang rê trên canvas (để tô sáng ô); null khi không rê. */
  hover: { x: number; y: number; at: number } | null = null

  /** Hướng di chuyển mong muốn, độ dài tối đa 1. */
  moveVector(): { x: number; y: number } {
    let x = this.joystick.x
    let y = this.joystick.y
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    return { x, y }
  }

  /** Gọi cuối mỗi khung hình để xoá các lượng tích luỹ. */
  endFrame(): void {
    this.zoomScale = 1
  }
}
