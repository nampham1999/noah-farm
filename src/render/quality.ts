import type * as THREE from 'three'

const SAMPLE_SECONDS = 2
const LOW_FPS = 40
const HIGH_FPS = 55
const STEP = 0.25
const MIN_RATIO = 0.6

/**
 * Tự giảm độ phân giải render khi FPS dưới 40 và tăng lại khi dư sức (GDD mục 4, 5.3).
 * pixelRatio luôn tối đa 2.
 */
export class AdaptiveQuality {
  private readonly renderer: THREE.WebGLRenderer
  private readonly maxRatio: number
  private ratio: number
  private frames = 0
  private elapsed = 0
  fps = 60

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.maxRatio = Math.min(window.devicePixelRatio, 2)
    this.ratio = this.maxRatio
  }

  tick(dt: number): void {
    this.frames++
    this.elapsed += dt
    if (this.elapsed < SAMPLE_SECONDS) return
    this.fps = this.frames / this.elapsed
    this.frames = 0
    this.elapsed = 0

    let next = this.ratio
    if (this.fps < LOW_FPS) next = Math.max(MIN_RATIO, this.ratio - STEP)
    else if (this.fps > HIGH_FPS) next = Math.min(this.maxRatio, this.ratio + STEP)
    if (next !== this.ratio) {
      this.ratio = next
      this.renderer.setPixelRatio(next)
    }
  }

  get pixelRatio(): number {
    return this.ratio
  }
}
