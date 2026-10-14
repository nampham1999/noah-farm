import type * as THREE from 'three'

/** Mỗi lần đo FPS kéo dài chừng này giây. */
const SAMPLE_SECONDS = 2
/** Chậm liên tiếp chừng này lần đo mới hạ một bậc (bỏ qua khựng thoáng qua lúc tải, mở cửa sổ). */
const BAD_SAMPLES_TO_DROP = 2
/** Mượt liên tiếp chừng này lần đo (12 giây) mới thử tăng lại một bậc. */
const GOOD_SAMPLES_TO_RAISE = 6
/** Vừa hạ bậc thì chờ chừng này giây mới được tăng lại; bậc nào đã phải hạ 2 lần thì không tăng lên nữa. */
const RAISE_COOLDOWN_S = 30
/** Điện thoại: độ phân giải tối đa (màn hình điện thoại nhỏ, 1,5 đã đủ nét mà nhẹ hơn nhiều so với 2–3). */
const MOBILE_MAX_RATIO = 1.5

export interface QualityLevel {
  ratio: number
  shadows: boolean
}

/**
 * Tự chỉnh chất lượng để giữ FPS ổn định (GDD mục 4, 5.3), theo bậc:
 * độ phân giải cao nhất → giảm dần tới 1 → tắt bóng đổ → giảm tiếp tới 0,65.
 * Đổi bậc tốn một lần dựng lại canvas (khựng một nhịp), nên chỉ hạ khi chậm kéo dài
 * và tăng lại rất dè dặt để không đổi qua đổi lại.
 */
export class AdaptiveQuality {
  private readonly renderer: THREE.WebGLRenderer
  private readonly onChange: (level: QualityLevel) => void
  private levels: QualityLevel[] = []
  private index = 0
  private target = 60
  private frames = 0
  private elapsed = 0
  private bad = 0
  private good = 0
  private clock = 0
  private lastDropAt = -Infinity
  /** Số lần đã phải hạ khỏi mỗi bậc. */
  private drops = new Map<number, number>()
  fps = 60

  constructor(renderer: THREE.WebGLRenderer, onChange: (level: QualityLevel) => void) {
    this.renderer = renderer
    this.onChange = onChange
    this.setTarget(60, 2)
  }

  /** Đổi mục tiêu: 60 FPS bình thường, 30 FPS và độ phân giải tối đa 1 khi tiết kiệm pin. */
  setTarget(fps: number, maxRatio: number): void {
    this.target = fps
    const mobile = matchMedia('(pointer: coarse)').matches
    const top = Math.min(window.devicePixelRatio || 1, maxRatio, mobile ? MOBILE_MAX_RATIO : 2)
    const levels: QualityLevel[] = []
    for (let r = top; r > 1.01; r -= 0.25) levels.push({ ratio: +r.toFixed(2), shadows: true })
    levels.push({ ratio: Math.min(1, top), shadows: true })
    levels.push({ ratio: Math.min(1, top), shadows: false })
    for (const r of [0.8, 0.65]) if (r < Math.min(1, top)) levels.push({ ratio: r, shadows: false })
    this.levels = levels
    this.drops.clear()
    this.bad = this.good = 0
    this.apply(0)
  }

  tick(dt: number): void {
    this.frames++
    this.elapsed += dt
    this.clock += dt
    if (this.elapsed < SAMPLE_SECONDS) return
    this.fps = this.frames / this.elapsed
    this.frames = 0
    this.elapsed = 0

    if (this.fps < this.target * 0.75) {
      this.good = 0
      if (++this.bad >= BAD_SAMPLES_TO_DROP && this.index < this.levels.length - 1) {
        this.bad = 0
        this.drops.set(this.index, (this.drops.get(this.index) ?? 0) + 1)
        this.lastDropAt = this.clock
        this.apply(this.index + 1)
      }
    } else if (this.fps > this.target * 0.95) {
      this.bad = 0
      const up = this.index - 1
      const canRaise = up >= 0 && this.clock - this.lastDropAt > RAISE_COOLDOWN_S && (this.drops.get(up) ?? 0) < 2
      if (canRaise && ++this.good >= GOOD_SAMPLES_TO_RAISE) {
        this.good = 0
        this.apply(up)
      }
    } else {
      this.bad = 0
      this.good = 0
    }
  }

  private apply(index: number): void {
    const prev = this.levels[this.index]
    this.index = index
    const next = this.levels[index]
    if (!prev || prev.ratio !== next.ratio) this.renderer.setPixelRatio(next.ratio)
    this.onChange(next)
  }

  get pixelRatio(): number {
    return this.levels[this.index]?.ratio ?? 1
  }

  get shadows(): boolean {
    return this.levels[this.index]?.shadows ?? true
  }
}
