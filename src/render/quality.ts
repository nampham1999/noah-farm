import type * as THREE from 'three'

const SAMPLE_SECONDS = 2
const STEP = 0.25
const MIN_RATIO = 0.6
/** Phải tốt liên tiếp chừng này lần đo mới tăng độ phân giải, để khỏi đổi qua đổi lại. */
const GOOD_SAMPLES_TO_RAISE = 3

/**
 * Tự giảm độ phân giải render khi FPS dưới khoảng 2/3 mục tiêu (40 khi mục tiêu 60)
 * và tăng lại khi dư sức (GDD mục 4, 5.3). pixelRatio tối đa 2, hoặc 1 khi tiết kiệm pin.
 */
export class AdaptiveQuality {
  private readonly renderer: THREE.WebGLRenderer
  private maxRatio: number
  private ratio: number
  private target = 60
  private frames = 0
  private elapsed = 0
  private good = 0
  fps = 60

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.maxRatio = Math.min(window.devicePixelRatio, 2)
    this.ratio = this.maxRatio
  }

  /** Đổi mục tiêu: 60 FPS bình thường, 30 FPS và độ phân giải tối đa 1 khi tiết kiệm pin. */
  setTarget(fps: number, maxRatio: number): void {
    this.target = fps
    this.maxRatio = Math.min(window.devicePixelRatio, maxRatio)
    if (this.ratio > this.maxRatio) this.apply(this.maxRatio)
    this.good = 0
  }

  tick(dt: number): void {
    this.frames++
    this.elapsed += dt
    if (this.elapsed < SAMPLE_SECONDS) return
    this.fps = this.frames / this.elapsed
    this.frames = 0
    this.elapsed = 0

    if (this.fps < this.target * 0.67) {
      this.good = 0
      this.apply(Math.max(MIN_RATIO, this.ratio - STEP))
    } else if (this.fps > this.target * 0.92) {
      if (++this.good >= GOOD_SAMPLES_TO_RAISE) {
        this.good = 0
        this.apply(Math.min(this.maxRatio, this.ratio + STEP))
      }
    } else {
      this.good = 0
    }
  }

  private apply(next: number): void {
    if (next === this.ratio) return
    this.ratio = next
    this.renderer.setPixelRatio(next)
  }

  get pixelRatio(): number {
    return this.ratio
  }
}
