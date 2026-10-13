import { sound } from './sound.ts'

/**
 * Nhạc nền tự sinh, nhẹ nhàng (GDD mục 1: "nhạc nhẹ"): vòng hợp âm C – Am – F – G,
 * pad êm, bass, giai điệu ngũ cung ngẫu nhiên có vọng. Ban đêm chậm và thưa hơn.
 */

const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
]
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]

class Music {
  private nextBar = 0
  private bar = 0
  private echo: DelayNode | null = null
  private calm = false

  /** Ban đêm và trong nhà thì nhạc êm hơn. */
  setCalm(calm: boolean): void {
    this.calm = calm
  }

  /** Gọi thường xuyên; lên lịch trước các ô nhịp sắp tới (kiểu "lookahead scheduler"). */
  update(): void {
    const ctx = sound.ctx
    const out = sound.musicGain
    if (!ctx || !out || ctx.state !== 'running') return
    if (!this.echo) {
      this.echo = ctx.createDelay(1)
      this.echo.delayTime.value = 0.42
      const feedback = ctx.createGain()
      feedback.gain.value = 0.32
      this.echo.connect(feedback)
      feedback.connect(this.echo)
      this.echo.connect(out)
    }
    const barLen = this.calm ? 4.4 : 3.4
    if (this.nextBar < ctx.currentTime) this.nextBar = ctx.currentTime + 0.1
    while (this.nextBar < ctx.currentTime + 1) {
      this.scheduleBar(this.nextBar, barLen, out)
      this.nextBar += barLen
      this.bar++
    }
  }

  private scheduleBar(t: number, len: number, out: AudioNode): void {
    const chord = CHORDS[this.bar % CHORDS.length]
    // Pad: ba nốt hợp âm, tam giác qua lọc thấp, lên xuống chậm.
    for (const f of chord) this.pad(t, f, len, out)
    // Bass ở đầu ô nhịp.
    sound.tone(t, chord[0] / 2, chord[0] / 2, len * 0.6, 'sine', 0.22, 0, out)
    // Giai điệu: vài nốt ngũ cung rải rác, có vọng.
    const notes = this.calm ? 2 : 4
    for (let i = 0; i < notes; i++) {
      if (Math.random() < 0.35) continue
      const f = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]
      sound.pluck(t + (i * len) / notes + Math.random() * 0.08, f, 0.9, 0.09, this.echo ?? out)
    }
  }

  private pad(t: number, freq: number, len: number, out: AudioNode): void {
    const ctx = sound.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    osc.detune.value = (Math.random() - 0.5) * 8
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.06, t + len * 0.3)
    g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05)
    osc.connect(filter)
    filter.connect(g)
    g.connect(out)
    osc.start(t)
    osc.stop(t + len * 1.1)
  }
}

export const music = new Music()
