/**
 * Âm thanh tổng hợp bằng Web Audio (GDD mục 5.1): không tải file nào, không vướng bản quyền.
 * Mỗi hiệu ứng là vài bộ dao động hoặc tiếng ồn có bao âm ngắn.
 */

export type SfxName =
  | 'till' | 'plant' | 'water' | 'harvest' | 'coin' | 'levelUp' | 'quest'
  | 'cast' | 'bite' | 'catch' | 'escape' | 'chicken' | 'cow' | 'pig'
  | 'place' | 'error' | 'click' | 'newDay' | 'thunder' | 'dog' | 'horse' | 'whistle' | 'cheer'

class Sound {
  ctx: AudioContext | null = null
  private sfxGain: GainNode | null = null
  musicGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private sfxVolume = 0.7
  private musicVolume = 0.5
  private lastPlayed = new Map<SfxName, number>()

  /** Trình duyệt chỉ cho phát âm thanh sau thao tác đầu tiên của người chơi. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    const master = this.ctx.createGain()
    master.connect(this.ctx.destination)
    this.sfxGain = this.ctx.createGain()
    this.musicGain = this.ctx.createGain()
    this.sfxGain.connect(master)
    this.musicGain.connect(master)
    this.applyVolumes()
    // Bộ đệm tiếng ồn trắng dùng chung cho tiếng đất, nước, vút cần.
    const len = this.ctx.sampleRate
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx
    this.musicVolume = music
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return
    const now = this.ctx.currentTime
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume * 0.8, now, 0.05)
    this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.35, now, 0.2)
  }

  private rainGain: GainNode | null = null

  /** Tiếng mưa chạy nền: 0 là tắt; đổi dần cho êm. */
  setRain(level: number): void {
    if (!this.ctx || !this.noise || !this.sfxGain) return
    if (!this.rainGain) {
      if (level <= 0) return
      const ctx = this.ctx
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 700
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 4500
      this.rainGain = ctx.createGain()
      this.rainGain.gain.value = 0
      src.connect(hp)
      hp.connect(lp)
      lp.connect(this.rainGain)
      this.rainGain.connect(this.sfxGain)
      src.start()
    }
    this.rainGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.8)
  }

  /** Ẩn tab thì dừng hẳn cho đỡ tốn pin. */
  setSuspended(hidden: boolean): void {
    if (!this.ctx) return
    void (hidden ? this.ctx.suspend() : this.ctx.resume())
  }

  play(name: SfxName): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxGain || ctx.state !== 'running' || this.sfxVolume <= 0) return
    // Cùng một tiếng không phát dồn dập (vd. thu hoạch cả luống).
    const t = ctx.currentTime
    if (t - (this.lastPlayed.get(name) ?? -1) < 0.06) return
    this.lastPlayed.set(name, t)

    switch (name) {
      case 'till':
        this.noiseBurst(t, 0.12, 'lowpass', 900, 300, 0.5)
        this.tone(t, 90, 55, 0.12, 'sine', 0.5)
        break
      case 'plant':
        this.tone(t, 520, 760, 0.08, 'sine', 0.35)
        break
      case 'water':
        this.noiseBurst(t, 0.35, 'bandpass', 2600, 900, 0.35)
        this.tone(t + 0.05, 1200, 700, 0.08, 'sine', 0.12)
        break
      case 'harvest':
        this.pluck(t, 660, 0.18, 0.35)
        this.pluck(t + 0.08, 990, 0.22, 0.3)
        break
      case 'coin':
        this.tone(t, 1320, 1320, 0.07, 'square', 0.12)
        this.tone(t + 0.07, 1760, 1760, 0.16, 'square', 0.12)
        break
      case 'levelUp':
        ;[523, 659, 784, 1047].forEach((f, i) => this.pluck(t + i * 0.09, f, 0.35, 0.3))
        break
      case 'quest':
        ;[784, 988, 1175].forEach((f, i) => this.pluck(t + i * 0.07, f, 0.3, 0.25))
        break
      case 'cast':
        this.noiseBurst(t, 0.25, 'highpass', 1500, 4000, 0.25)
        this.tone(t + 0.28, 400, 180, 0.12, 'sine', 0.3)
        break
      case 'bite':
        this.noiseBurst(t, 0.15, 'bandpass', 1800, 600, 0.4)
        this.tone(t, 300, 120, 0.1, 'sine', 0.4)
        break
      case 'catch':
        ;[659, 784, 1047, 1319].forEach((f, i) => this.pluck(t + i * 0.08, f, 0.3, 0.3))
        break
      case 'escape':
        ;[523, 440, 349].forEach((f, i) => this.tone(t + i * 0.1, f, f * 0.95, 0.12, 'triangle', 0.25))
        break
      case 'chicken':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.09, 900 + i * 60, 1400, 0.06, 'square', 0.08)
        break
      case 'cow':
        this.tone(t, 160, 110, 0.7, 'sawtooth', 0.12, 600)
        break
      case 'pig':
        this.tone(t, 260, 200, 0.12, 'square', 0.1, 900)
        this.tone(t + 0.16, 240, 180, 0.12, 'square', 0.1, 900)
        break
      case 'place':
        this.tone(t, 180, 120, 0.1, 'triangle', 0.4)
        this.noiseBurst(t, 0.06, 'lowpass', 1200, 400, 0.2)
        break
      case 'error':
        this.tone(t, 180, 160, 0.16, 'square', 0.08, 700)
        break
      case 'click':
        this.tone(t, 1800, 1500, 0.03, 'sine', 0.12)
        break
      case 'newDay':
        ;[784, 1047, 1319].forEach((f, i) => this.pluck(t + i * 0.12, f, 0.6, 0.2))
        break
      case 'dog':
        // Hai tiếng "gâu" ngắn.
        for (const d of [0, 0.22]) {
          this.tone(t + d, 520, 300, 0.12, 'sawtooth', 0.22, 1400)
          this.noiseBurst(t + d, 0.08, 'bandpass', 900, 500, 0.15)
        }
        break
      case 'horse':
        // Tiếng hí: âm cao rung rồi trượt xuống.
        this.tone(t, 900, 1300, 0.25, 'sawtooth', 0.12, 2200)
        this.tone(t + 0.22, 1250, 600, 0.6, 'sawtooth', 0.12, 1800)
        break
      case 'whistle':
        // Còi xuất phát: tiếng huýt cao rung nhanh.
        for (let k = 0; k < 6; k++) this.tone(t + k * 0.07, 2300, 2500, 0.07, 'square', 0.06, 4000)
        break
      case 'cheer':
        // Khán giả reo hò: tiếng ồn dải giữa phồng lên rồi tắt dần.
        this.noiseBurst(t, 1.6, 'bandpass', 1100, 700, 0.5)
        this.noiseBurst(t + 0.15, 1.2, 'bandpass', 1800, 1200, 0.3)
        break
      case 'thunder':
        // Tiếng nổ ngắn rồi rền trầm kéo dài.
        this.noiseBurst(t, 0.35, 'bandpass', 1400, 200, 0.35)
        this.noiseBurst(t + 0.05, 2.4, 'lowpass', 320, 50, 0.9)
        break
    }
  }

  /** Một nốt với tần số trượt từ f0 sang f1 và bao âm tắt dần. */
  tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number, lowpass = 0, out?: AudioNode): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    let node: AudioNode = osc
    if (lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = lowpass
      osc.connect(f)
      node = f
    }
    node.connect(g)
    g.connect(out ?? this.sfxGain!)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  /** Nốt gảy kiểu đàn: tam giác + sine bát độ, tắt nhanh. */
  pluck(t: number, freq: number, dur: number, vol: number, out?: AudioNode): void {
    this.tone(t, freq, freq, dur, 'triangle', vol, 0, out)
    this.tone(t, freq * 2, freq * 2, dur * 0.6, 'sine', vol * 0.3, 0, out)
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.Q.value = type === 'bandpass' ? 1.5 : 0.7
    filter.frequency.setValueAtTime(f0, t)
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.sfxGain!)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.05)
  }
}

export const sound = new Sound()
