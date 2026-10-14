import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import { online } from '../online/online.ts'
import { publishBet, watchBets, type PublicBet } from '../online/raceBets.ts'
import { DOGS, dogProgress, MAX_BET, MIN_BET, placeBet, raceAt, RUN_MS, BET_MS, type Race } from '../systems/race.ts'
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
      canvas.width = 600
      canvas.height = 300
      body.append(status, canvas)

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

/** Vẽ đường đua: 5 làn, vạch đích, chó chạy theo thời gian của cuộc đua (giống nhau trên mọi máy). */
function drawTrack(c: HTMLCanvasElement, race: Race, mine: number): void {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.fillStyle = '#7cb342'
  g.fillRect(0, 0, W, H)
  const top = 20
  const laneH = (H - top * 2) / DOGS.length
  const startX = 70
  const endX = W - 50
  for (let i = 0; i < DOGS.length; i++) {
    const y = top + i * laneH
    g.fillStyle = i % 2 ? '#d9a15e' : '#e3bd82'
    g.fillRect(0, y, W, laneH)
    if (i === mine) {
      g.fillStyle = 'rgba(255, 201, 58, 0.35)'
      g.fillRect(0, y, W, laneH)
    }
  }
  // Vạch xuất phát và vạch đích (ô cờ).
  g.fillStyle = '#fffaf0'
  g.fillRect(startX - 4, top, 4, H - top * 2)
  for (let k = 0; k < (H - top * 2) / 10; k++) {
    g.fillStyle = k % 2 ? '#3a3a40' : '#fffaf0'
    g.fillRect(endX, top + k * 10, 10, 10)
  }
  const u = race.phase === 'betting' ? 0 : race.phase === 'running' ? Math.min(1, (Date.now() - race.startAt - BET_MS) / RUN_MS) : 1
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let i = 0; i < DOGS.length; i++) {
    const y = top + i * laneH + laneH / 2
    const p = dogProgress(race, i, u)
    const x = startX + (endX - startX - 20) * p
    const bob = race.phase === 'running' && p < 1 ? Math.sin(Date.now() / 60 + i) * 3 : 0
    // Số áo và màu của chó.
    g.fillStyle = DOGS[i].color
    g.beginPath()
    g.arc(x - 26, y, 12, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = DOGS[i].color === '#3a3a40' || DOGS[i].color === '#8a5a2f' ? '#fff' : '#4a2e14'
    g.font = 'bold 16px Fredoka, sans-serif'
    g.fillText(String(i + 1), x - 26, y + 1)
    g.font = '34px sans-serif'
    g.save()
    g.translate(x, y + bob)
    g.scale(-1, 1)
    g.fillText('🐕', 0, 0)
    g.restore()
    if (race.phase === 'results' && i === race.winner) g.fillText('🏆', x + 30, y)
  }
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
