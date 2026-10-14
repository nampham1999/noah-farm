import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import { online } from '../online/online.ts'
import { publishBet, watchBets, type PublicBet } from '../online/raceBets.ts'
import { BET_MS, DOGS, dogProgress, MAX_BET, MIN_BET, placeBet, raceAt, RUN_MS, standings, type Race } from '../systems/race.ts'
import type { PanelSpec } from './panel.ts'

const AMOUNTS = [MIN_BET, 100, 200, MAX_BET]

/** Cửa sổ trường đua chó: đường đua (mọi máy thấy giống nhau), tỉ lệ ăn, đặt cược, cược của mọi người. */
export function racePanel(state: GameState): PanelSpec {
  let open = false
  let dog = 0
  let amount = 100
  let bets: PublicBet[] = []
  let watchedId = -1
  let stopBets: (() => void) | null = null
  let canvas: HTMLCanvasElement | null = null
  let status: HTMLElement | null = null
  let comment: HTMLElement | null = null
  let commentText = ''
  let lastLeader = -1
  let started = false
  let finished = false
  let shownPhase = ''
  let redraw: (() => void) | null = null

  const loop = () => {
    if (!open) return
    const race = raceAt()
    // Sang giai đoạn khác hoặc cuộc đua mới thì vẽ lại cả cửa sổ.
    const key = `${race.id}|${race.phase}`
    if (key !== shownPhase) {
      shownPhase = key
      if (race.id !== watchedId) watch(race.id)
      redraw?.()
    }
    if (status) status.textContent = statusText(race)
    if (canvas) drawTrack(canvas, race, state.race?.id === race.id ? state.race.dog : -1)
    // Lời bình và âm thanh: còi xuất phát, đổi người dẫn đầu, về đích.
    if (race.phase === 'running') {
      const u = raceU(race)
      const leader = standings(race, u)[0]
      if (!started) {
        started = true
        finished = false
        bus.emit('sfx', 'whistle')
        commentText = t('race.comment.start')
      } else if (leader !== lastLeader && u > 0.08 && u < race.finish[leader]) {
        commentText = t('race.comment.lead', { dog: DOGS[leader].name })
      }
      if (!finished && dogProgress(race, race.winner, u) >= 1) {
        finished = true
        bus.emit('sfx', 'cheer')
        commentText = t('race.comment.finish', { dog: DOGS[race.winner].name })
      }
      lastLeader = leader
    } else {
      started = race.phase === 'results'
      if (race.phase === 'betting') commentText = ''
    }
    if (comment && comment.textContent !== commentText) {
      comment.textContent = commentText
      comment.hidden = commentText === ''
    }
    requestAnimationFrame(loop)
  }

  const watch = (id: number) => {
    watchedId = id
    bets = []
    stopBets?.()
    stopBets = null
    void watchBets(id, (list) => {
      bets = list
      redraw?.()
    }).then((stop) => {
      if (watchedId === id) stopBets = stop
      else stop()
    })
  }

  return {
    title: () => `🐕 ${t('race.title')}`,
    onClose: () => {
      open = false
      stopBets?.()
      stopBets = null
      watchedId = -1
    },
    render(body, refresh) {
      redraw = refresh
      const race = raceAt()
      status = document.createElement('p')
      status.className = 'race-status'
      status.textContent = statusText(race)
      canvas = document.createElement('canvas')
      canvas.className = 'race-track'
      canvas.width = 640
      canvas.height = 330
      comment = document.createElement('p')
      comment.className = 'race-comment'
      comment.textContent = commentText
      comment.hidden = commentText === ''
      body.append(status, canvas, comment)

      const myBet = state.race?.id === race.id ? state.race : null
      if (myBet) {
        body.append(note(t('race.yourBet', { amount: myBet.amount, dog: DOGS[myBet.dog].name, odds: myBet.odds })))
      } else if (race.phase === 'betting') {
        // Chọn chó (kèm tỉ lệ ăn) và mức cược.
        const dogs = document.createElement('div')
        dogs.className = 'race-dogs'
        DOGS.forEach((d, i) => {
          const b = document.createElement('button')
          b.className = 'race-dog' + (dog === i ? ' is-on' : '')
          b.innerHTML = `<span class="race-dog__dot"></span><span class="race-dog__name"></span><span class="race-dog__odds"></span>`
          ;(b.querySelector('.race-dog__dot') as HTMLElement).style.background = d.color
          b.querySelector('.race-dog__name')!.textContent = `${i + 1}. ${d.name}`
          b.querySelector('.race-dog__odds')!.textContent = `×${race.odds[i]}`
          b.addEventListener('click', () => {
            dog = i
            refresh()
          })
          dogs.append(b)
        })
        const amounts = document.createElement('div')
        amounts.className = 'race-amounts'
        for (const a of AMOUNTS) {
          const b = document.createElement('button')
          b.className = 'look-chip' + (amount === a ? ' is-on' : '')
          b.textContent = `${a}g`
          b.disabled = state.player.gold < a
          b.addEventListener('click', () => {
            amount = a
            refresh()
          })
          amounts.append(b)
        }
        const go = document.createElement('button')
        go.className = 'btn gold'
        go.textContent = t('race.bet', { amount, dog: DOGS[dog].name, win: Math.round(amount * race.odds[dog]) })
        go.disabled = state.player.gold < amount
        go.addEventListener('click', () => {
          if (placeBet(state, dog, amount)) {
            if (online.status === 'on') void publishBet(race.id, state.player.name, dog, amount)
            refresh()
          }
        })
        body.append(dogs, amounts, go)
      } else {
        body.append(note(t('race.waitNext')))
      }
      if (race.phase === 'results') {
        const podium = standings(race, 1).slice(0, 3)
        body.append(note(['🥇', '🥈', '🥉'].map((m, k) => `${m} ${podium[k] + 1}. ${DOGS[podium[k]].name}`).join('   ')))
        body.append(note(t('race.winner', { n: race.winner + 1, dog: DOGS[race.winner].name, odds: race.odds[race.winner] })))
      }

      // Cược của mọi người cho cuộc đua này.
      if (bets.length) {
        const list = document.createElement('div')
        list.className = 'race-bets'
        for (const b of bets) list.append(note(`${b.name}: ${b.amount}g → ${b.dog + 1}. ${DOGS[b.dog]?.name ?? '?'}`))
        body.append(heading(t('race.bets')), list)
      }
      body.append(note(t('race.hint')))

      if (!open) {
        open = true
        shownPhase = ''
        requestAnimationFrame(loop)
      }
    },
  }
}

function statusText(race: Race): string {
  const s = Math.ceil(race.left / 1000)
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return t(`race.phase.${race.phase}`, { n: race.id % 1000, time })
}

/** Đường đua dài gấp chừng này lần khung nhìn: camera lướt theo chó dẫn đầu. */
const TRACK_SCREENS = 3.2
const LANE_TOP = 92
const LANE_BOTTOM_PAD = 18
const START_PAD = 70
const END_PAD = 60
const CROWD = ['#e2483a', '#4a90d9', '#f2c75c', '#7cb342', '#e88fb0', '#8e6cc9', '#f4efe2', '#e0704a']

/** Thời điểm u (0..1 của RUN_MS) của cuộc đua: 0 khi đang mở cược, 1 khi đã có kết quả. */
export function raceU(race: Race): number {
  return race.phase === 'betting' ? 0 : race.phase === 'running' ? Math.min(1, (Date.now() - race.startAt - BET_MS) / RUN_MS) : 1
}

/**
 * Vẽ cuộc đua: khán đài cổ vũ, hàng rào, cột mốc trôi qua khi camera lướt theo chó dẫn đầu;
 * chó có chân phi, đuôi vẫy, khăn số, bụi tung; bảng thứ hạng; đếm ngược 3-2-1 lúc xuất phát.
 * Mọi thứ tính từ đồng hồ và số cuộc đua nên các máy vẽ giống nhau.
 */
function drawTrack(c: HTMLCanvasElement, race: Race, mine: number): void {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  const now = Date.now()
  const time = now / 1000
  const u = raceU(race)
  const L = W * TRACK_SCREENS
  const trackX = (p: number) => START_PAD + p * (L - START_PAD - END_PAD)
  const pos = DOGS.map((_, i) => dogProgress(race, i, u))
  const lead = Math.max(...pos)
  // Về đích rồi thì chạy chậm dần qua vạch (về trước chạy xa hơn), camera dừng ở vạch đích.
  const finalOrder = race.phase === 'results' ? standings(race, 1) : null
  const past = DOGS.map((_, i) => {
    // Kết quả: xếp hàng theo thứ hạng, về nhất đứng xa vạch nhất.
    if (finalOrder) return 130 - finalOrder.indexOf(i) * 24
    const over = Math.max(0, u - race.finish[i])
    return pos[i] >= 1 ? (1 - Math.exp(-over * 18)) * 110 : 0
  })
  const camMax = trackX(1) - W * 0.55
  const cam = race.phase === 'betting' ? 0 : Math.max(0, Math.min(camMax, trackX(lead) - W * 0.62))
  const laneH = (H - LANE_TOP - LANE_BOTTOM_PAD) / DOGS.length

  // Trời và khán đài (trôi chậm hơn đường đua cho có chiều sâu).
  const sky = g.createLinearGradient(0, 0, 0, 60)
  sky.addColorStop(0, '#8fd3ff')
  sky.addColorStop(1, '#cfeeff')
  g.fillStyle = sky
  g.fillRect(0, 0, W, 60)
  g.fillStyle = '#b06e33'
  g.fillRect(0, 44, W, 30)
  const crowdShift = cam * 0.5
  const cheering = race.phase !== 'betting'
  for (let k = Math.floor(crowdShift / 14) - 1; k < (crowdShift + W) / 14 + 1; k++) {
    const x = k * 14 - crowdShift
    for (let row = 0; row < 2; row++) {
      const jump = cheering ? Math.max(0, Math.sin(time * 9 + k * 1.3 + row)) * 4 : 0
      g.fillStyle = CROWD[(k * 3 + row * 5) & 7]
      g.beginPath()
      g.arc(x + row * 7, 52 + row * 11 - jump, 5, 0, Math.PI * 2)
      g.fill()
    }
  }
  // Cờ đuôi nheo trên khán đài.
  for (let k = Math.floor(crowdShift / 40); k < (crowdShift + W) / 40 + 1; k++) {
    const x = k * 40 - crowdShift
    g.fillStyle = CROWD[k & 7]
    g.beginPath()
    g.moveTo(x, 30)
    g.lineTo(x + 16, 30)
    g.lineTo(x + 8, 42 + Math.sin(time * 4 + k) * 2)
    g.fill()
  }

  // Cỏ, các làn đất, vạch chia làn.
  g.fillStyle = '#6cae3e'
  g.fillRect(0, 74, W, H - 74)
  for (let i = 0; i < DOGS.length; i++) {
    const y = LANE_TOP + i * laneH
    g.fillStyle = i % 2 ? '#d9a15e' : '#e3bd82'
    g.fillRect(0, y, W, laneH)
    if (i === mine) {
      g.fillStyle = 'rgba(255, 201, 58, 0.3)'
      g.fillRect(0, y, W, laneH)
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(0, y, W, 1.5)
  }
  // Hàng rào trắng trên và dưới đường đua (cột trôi theo camera).
  for (const y of [LANE_TOP - 12, H - LANE_BOTTOM_PAD + 2]) {
    g.fillStyle = '#fffaf0'
    g.fillRect(0, y + 3, W, 3)
    for (let k = Math.floor(cam / 48); k < (cam + W) / 48 + 1; k++) g.fillRect(k * 48 - cam, y, 4, 12)
  }
  // Cột mốc mỗi 1/4 quãng đường.
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const m of [0.25, 0.5, 0.75]) {
    const x = trackX(m) - cam
    if (x < -20 || x > W + 20) continue
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.setLineDash([6, 6])
    g.beginPath()
    g.moveTo(x, LANE_TOP)
    g.lineTo(x, H - LANE_BOTTOM_PAD)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = '#fffaf0'
    g.font = 'bold 13px Fredoka, sans-serif'
    g.fillText(`${m * 400}m`, x, LANE_TOP - 18)
  }
  // Vạch xuất phát và vạch đích ô cờ.
  const sx = trackX(0) - cam
  if (sx > -10) {
    g.fillStyle = '#fffaf0'
    g.fillRect(sx - 3, LANE_TOP, 4, H - LANE_TOP - LANE_BOTTOM_PAD)
  }
  const fx = trackX(1) - cam
  if (fx < W + 20) {
    for (let k = 0; k < (H - LANE_TOP - LANE_BOTTOM_PAD) / 8; k++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle = (k + col) % 2 ? '#3a3a40' : '#fffaf0'
        g.fillRect(fx + col * 8, LANE_TOP + k * 8, 8, 8)
      }
    }
  }

  // Chó: chạy sau thì vẽ trước.
  const order = standings(race, u)
  for (let i = 0; i < DOGS.length; i++) {
    const y = LANE_TOP + i * laneH + laneH * 0.62
    const x = trackX(pos[i]) - cam + past[i]
    const running = race.phase === 'running' && past[i] < 105
    if (running) {
      // Bụi tung sau chân.
      for (let k = 0; k < 4; k++) {
        const age = (time * 3 + k * 0.25 + i * 0.13) % 1
        g.fillStyle = `rgba(160, 120, 70, ${0.45 * (1 - age)})`
        g.beginPath()
        g.arc(x - 30 - age * 26, y + 6 - age * 6, 3 + age * 5, 0, Math.PI * 2)
        g.fill()
      }
    }
    drawDog(g, x, y, DOGS[i].color, i, time, running, laneH)
    if (race.phase === 'results') {
      const place = order.indexOf(i)
      if (place < 3) {
        g.font = '22px sans-serif'
        g.fillText(['🥇', '🥈', '🥉'][place], x + 34, y - 6)
      }
    }
  }

  // Bảng thứ hạng trực tiếp.
  if (race.phase !== 'betting') {
    g.fillStyle = 'rgba(46, 30, 14, 0.7)'
    g.beginPath()
    g.roundRect(6, 6, 150, 20, 10)
    g.fill()
    order.forEach((d, k) => {
      g.fillStyle = DOGS[d].color
      g.beginPath()
      g.arc(20 + k * 28, 16, 8, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = DOGS[d].color === '#3a3a40' || DOGS[d].color === '#8a5a2f' ? '#fff' : '#4a2e14'
      g.font = 'bold 11px Fredoka, sans-serif'
      g.fillText(String(d + 1), 20 + k * 28, 17)
    })
  }

  // Đếm ngược 3-2-1 cuối giờ cược, rồi "Chạy!".
  const toStart = race.startAt + BET_MS - now
  const sinceStart = now - race.startAt - BET_MS
  const big = race.phase === 'betting' && toStart <= 3000 ? String(Math.ceil(toStart / 1000)) : race.phase === 'running' && sinceStart < 900 ? t('race.go') : ''
  if (big) {
    g.font = 'bold 72px Fredoka, sans-serif'
    g.lineWidth = 8
    g.strokeStyle = '#4e2a0c'
    g.fillStyle = '#ffc93a'
    g.strokeText(big, W / 2, H / 2 + 10)
    g.fillText(big, W / 2, H / 2 + 10)
  }
}

/** Một chú chó vẽ bằng hình khối: thân, đầu, tai, chân phi, đuôi vẫy, khăn số trên lưng. */
function drawDog(g: CanvasRenderingContext2D, x: number, y: number, color: string, n: number, time: number, running: boolean, laneH: number): void {
  const s = Math.min(1.25, laneH / 38)
  const dark = color === '#3a3a40' || color === '#8a5a2f'
  const gait = running ? time * 22 + n : 0
  const bob = running ? Math.abs(Math.sin(gait)) * 3 : 0
  g.save()
  g.translate(x, y - bob)
  g.scale(s, s)
  g.lineCap = 'round'
  // Chân: hai cặp phi lệch pha.
  g.strokeStyle = dark ? '#222' : '#6b5444'
  g.lineWidth = 4
  for (const [lx, phase] of [[-14, 0], [-8, Math.PI], [8, Math.PI / 2], [14, Math.PI * 1.5]] as const) {
    const a = running ? Math.sin(gait + phase) * 0.7 : 0
    g.beginPath()
    g.moveTo(lx, 4)
    g.lineTo(lx + Math.sin(a) * 10, 4 + Math.cos(a) * 10)
    g.stroke()
  }
  // Đuôi vẫy.
  g.lineWidth = 4
  g.strokeStyle = color
  g.beginPath()
  g.moveTo(-20, -3)
  g.quadraticCurveTo(-30, -10 - Math.sin(time * (running ? 18 : 6)) * 6, -32, -16)
  g.stroke()
  // Thân và đầu.
  g.fillStyle = color
  g.strokeStyle = dark ? '#111' : '#8a6a45'
  g.lineWidth = 1.5
  g.beginPath()
  g.ellipse(0, -2, 21, 10, 0, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.beginPath()
  g.arc(20, -11, 9, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  // Mõm, mũi, mắt, tai.
  g.beginPath()
  g.ellipse(28, -8, 6, 4, 0, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.fillStyle = '#222'
  g.beginPath()
  g.arc(33, -9, 2, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(22, -13, 1.6, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = dark ? '#111' : '#a0785a'
  g.beginPath()
  g.ellipse(15, -15, 4, 7, -0.5 + (running ? Math.sin(gait) * 0.3 : 0), 0, Math.PI * 2)
  g.fill()
  // Khăn số trên lưng.
  g.fillStyle = '#fffaf0'
  g.fillRect(-8, -12, 14, 11)
  g.fillStyle = '#4e2a0c'
  g.font = 'bold 10px Fredoka, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(n + 1), -1, -6)
  g.restore()
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-note'
  p.textContent = text
  return p
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3')
  h.className = 'trade-heading'
  h.textContent = text
  return h
}
