import { bus } from '../../core/events.ts'
import type { GameState } from '../../core/state.ts'
import type { GameId } from '../../cards/engine.ts'
import { t, tKey } from '../../i18n/index.ts'
import { cardTable, leaveTable, sendMove, startRound, type Session } from '../../online/cardTable.ts'
import { renderMauBinh } from './mauBinhView.ts'

export interface ViewCtx {
  session: Session
  me: string
  state: GameState
  send(move: unknown): void
  refresh(): void
}

const VIEWS: Partial<Record<GameId, (root: HTMLElement, ctx: ViewCtx) => void>> = {
  mauBinh: renderMauBinh,
}

let overlay: HTMLElement | null = null
let confirmLeave = false
let ticker = 0

/** Màn hình bàn bài: hiện khi đang ngồi bàn, tự đóng khi rời bàn. */
export function attachCardTable(ui: HTMLElement, state: GameState, myUid: () => string): void {
  const render = () => {
    const s = cardTable.session
    if (!s) {
      overlay?.remove()
      overlay = null
      clearInterval(ticker)
      ticker = 0
      confirmLeave = false
      return
    }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'ct'
      ui.append(overlay)
      // Có đồng hồ đếm ngược thì vẽ lại mỗi giây.
      ticker = window.setInterval(() => {
        if (cardTable.session?.pub?.deadline) render()
      }, 1000)
    }
    draw(overlay, s, state, myUid(), render)
  }
  bus.on('cardsChanged', render)
  bus.on('langChanged', render)
}

function draw(el: HTMLElement, s: Session, state: GameState, me: string, refresh: () => void): void {
  const scroll = el.querySelector('.ct__main')?.scrollTop ?? 0
  el.replaceChildren()
  const midRound = s.meta.status === 'playing'

  const top = document.createElement('div')
  top.className = 'ct__top'
  const title = document.createElement('div')
  title.className = 'ct__title'
  title.innerHTML = '<strong></strong><span></span>'
  title.querySelector('strong')!.textContent = `🃏 ${tKey(`cards.game.${s.meta.game}`)}`
  title.querySelector('span')!.textContent = t('cards.stakeLine', { stake: s.meta.stake })
  const leave = document.createElement('button')
  leave.className = 'btn small' + (confirmLeave ? ' danger' : '')
  leave.textContent = confirmLeave ? t('cards.leaveSure') : t('cards.leave')
  leave.addEventListener('click', () => {
    if (midRound && !confirmLeave) {
      confirmLeave = true
      refresh()
      return
    }
    confirmLeave = false
    void leaveTable()
  })
  top.append(title, leave)

  const seats = document.createElement('div')
  seats.className = 'ct__seats'
  const submitted = (s.pub?.submitted as string[] | undefined) ?? []
  for (const seat of s.seats) {
    const chip = document.createElement('div')
    chip.className = 'ct__seat' + (seat.uid === me ? ' is-me' : '')
    const gold = s.meta.results?.[seat.uid]
    chip.textContent = `${seat.uid === s.meta.host ? '👑 ' : ''}${seat.name}${midRound && submitted.includes(seat.uid) ? ' ✅' : ''}`
    if (gold !== undefined) {
      const d = document.createElement('b')
      d.className = gold >= 0 ? 'is-up' : 'is-down'
      d.textContent = ` ${gold >= 0 ? '+' : ''}${gold}`
      chip.append(d)
    }
    seats.append(chip)
  }

  const main = document.createElement('div')
  main.className = 'ct__main'
  if (s.meta.status === 'lobby' || !s.pub) {
    const p = document.createElement('p')
    p.className = 'ct__hint'
    p.textContent = s.isHost
      ? t('cards.hostWait', { n: s.seats.length, min: s.engine.min, max: s.engine.max })
      : t('cards.guestWait')
    main.append(p)
  } else {
    VIEWS[s.meta.game]?.(main, { session: s, me, state, send: (m) => void sendMove(m), refresh })
  }

  const bar = document.createElement('div')
  bar.className = 'ct__bottom'
  if (s.isHost && s.meta.status !== 'playing') {
    const go = document.createElement('button')
    go.className = 'btn primary'
    go.disabled = s.seats.length < s.engine.min
    go.textContent = s.meta.status === 'done' ? `🔁 ${t('cards.again')}` : `▶ ${t('cards.start')}`
    go.addEventListener('click', () => void startRound())
    bar.append(go)
  }
  el.append(top, seats, main, bar)
  main.scrollTop = scroll
}
