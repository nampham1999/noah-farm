import { bus } from '../../core/events.ts'
import type { GameState } from '../../core/state.ts'
import type { GameId } from '../../cards/engine.ts'
import { t, tKey } from '../../i18n/index.ts'
import { cardTable, leaveTable, sendEmote, sendMove, startRound, type Session } from '../../online/cardTable.ts'
import { animate, hueOf } from './cardEl.ts'
import { renderMauBinh } from './mauBinhView.ts'
import { renderPhom } from './phomView.ts'
import { renderTienLen } from './tienLenView.ts'
import { renderXiDach } from './xiDachView.ts'

export interface ViewCtx {
  session: Session
  me: string
  state: GameState
  send(move: unknown): void
  refresh(): void
  /** Vừa gửi nước đi, đang chờ bàn trả lời: nên khoá nút. */
  pending: boolean
}

/** Thông tin phụ của một ghế (số lá còn lại, nhãn trạng thái). */
export interface SeatInfo {
  cards?: number
  tag?: string
  tagKind?: 'ok' | 'bad'
}

/** Những phần một game đóng góp vào bàn; khung bàn lo ghế, đồng hồ, kết quả, biểu cảm. */
export interface ViewParts {
  /** Giữa bàn: bài vừa đánh, bộ bài, các cọc bài… */
  center: HTMLElement[]
  /** Bàn phẳng (không xếp ghế quanh bàn): Mậu binh. Phần center là vùng chính, cuộn được. */
  flat?: boolean
  banner?: HTMLElement
  /** Dòng phụ dưới dải hướng dẫn. */
  extra?: HTMLElement[]
  hand?: HTMLElement
  actions: HTMLElement[]
  seat?: (uid: string) => SeatInfo
}

const VIEWS: Record<GameId, (ctx: ViewCtx) => ViewParts> = {
  mauBinh: renderMauBinh,
  tienLen: renderTienLen,
  xiDach: renderXiDach,
  phom: renderPhom,
}

const EMOTES = ['😀', '😂', '😡', '😭', '👏', '🔥']
const EMOTE_MS = 2600

let overlay: HTMLElement | null = null
let confirmLeave = false
let showHelp = false
let ticker = 0
let frame = 0
let dismissed = ''
let lastSig = ''
let lastTurnMine = false

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
      showHelp = false
      lastSig = ''
      return
    }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'ct'
      ui.append(overlay)
      // Chỉ cập nhật đồng hồ (không dựng lại cả bàn, tránh giật và nuốt cú chạm).
      ticker = window.setInterval(updateTimers, 400)
    }
    sounds(s, myUid())
    draw(overlay, s, state, myUid(), schedule)
  }
  // Gộp nhiều cập nhật liên tiếp (bàn, ghế, bài) thành một lần vẽ mỗi khung hình.
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }
  bus.on('cardsChanged', schedule)
  bus.on('langChanged', schedule)
}

/** Âm thanh: có lá mới được đánh/chia thì "tách", tới lượt mình thì chuông nhẹ. */
function sounds(s: Session, me: string): void {
  const pub = s.pub
  if (!pub) return
  const { deadline: _d, ...rest } = pub as Record<string, unknown>
  void _d
  const sig = `${s.meta.round}:${JSON.stringify(rest)}`
  if (sig !== lastSig) {
    if (lastSig) bus.emit('sfx', 'place')
    lastSig = sig
  }
  const mine = pub.turn === me && s.meta.status === 'playing'
  if (mine && !lastTurnMine) bus.emit('sfx', 'quest')
  lastTurnMine = mine
}

function updateTimers(): void {
  if (!overlay) return
  const timer = overlay.querySelector<HTMLElement>('.ct__timer')
  if (timer) {
    const left = Math.max(0, Math.ceil((Number(timer.dataset.deadline) - Date.now()) / 1000))
    timer.textContent = `⏱ ${left}`
    timer.classList.toggle('is-low', left <= 8)
  }
  for (const ring of overlay.querySelectorAll<HTMLElement>('.av__ring')) {
    const left = Math.max(0, Number(ring.dataset.deadline) - Date.now())
    const p = Math.min(1, left / Number(ring.dataset.ms))
    ring.style.setProperty('--p', String(p))
    ring.style.setProperty('--ring', p < 0.3 ? '#ff6a4d' : '#ffcd50')
  }
}

function avatar(name: string, uid: string, small = false): HTMLElement {
  const av = document.createElement('div')
  av.className = 'av' + (small ? ' av--sm' : '')
  av.style.setProperty('--h', String(hueOf(uid)))
  av.textContent = [...name.trim()][0]?.toUpperCase() ?? '?'
  return av
}

function seatEl(s: Session, uid: string, info: SeatInfo, strip: boolean): HTMLElement {
  const seat = s.seats.find((x) => x.uid === uid)
  const pub = s.pub
  const el = document.createElement('div')
  el.className = 'seat' + (strip ? ' seat--strip' : '')
  const playing = s.meta.status === 'playing'
  const isTurn = playing && pub?.turn === uid
  if (isTurn) el.classList.add('is-turn')
  const av = avatar(seat?.name ?? '?', uid, strip)
  if (isTurn && pub?.deadline && pub?.ms) {
    const ring = document.createElement('div')
    ring.className = 'av__ring'
    ring.dataset.deadline = String(pub.deadline)
    ring.dataset.ms = String(pub.ms)
    av.append(ring)
  }
  if (uid === s.meta.host) {
    const b = document.createElement('span')
    b.className = 'av__badge'
    b.textContent = '👑'
    av.append(b)
  }
  el.append(av)
  const name = document.createElement('div')
  name.className = 'seat__name'
  name.textContent = seat?.name ?? '?'
  const col = document.createElement('div')
  col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px'
  col.append(name)
  if (info.cards !== undefined) {
    const backs = document.createElement('div')
    backs.className = 'backs'
    for (let i = 0; i < Math.min(3, info.cards); i++) {
      const c = document.createElement('div')
      c.className = 'pc pc--back'
      backs.append(c)
    }
    const n = document.createElement('b')
    n.textContent = String(info.cards)
    backs.append(n)
    col.append(backs)
  }
  const gold = s.meta.results?.[uid]
  if (gold !== undefined && s.meta.status === 'done') {
    const d = document.createElement('div')
    d.className = 'seat__delta ' + (gold >= 0 ? 'is-up' : 'is-down')
    d.textContent = `${gold >= 0 ? '+' : ''}${gold}`
    col.append(d)
  } else if (info.tag) {
    const tag = document.createElement('span')
    tag.className = 'seat__tag' + (info.tagKind ? ` is-${info.tagKind}` : '')
    tag.textContent = info.tag
    col.append(tag)
  }
  if (strip) {
    el.append(col)
  } else {
    el.append(...col.childNodes)
    el.style.alignItems = 'center'
  }
  const em = s.emotes[uid]
  if (em && Date.now() - em.at < EMOTE_MS) {
    const b = document.createElement('div')
    b.className = 'seat__emote'
    b.textContent = em.e
    b.style.animationDelay = `${-(Date.now() - em.at)}ms`
    el.append(b)
  }
  return el
}

/** Vị trí ghế đối thủ theo thứ tự ngược chiều kim đồng hồ từ mình (trái → trên → phải). */
function positions(n: number): string[] {
  return n <= 1 ? ['top'] : n === 2 ? ['left', 'right'] : n === 3 ? ['left', 'top', 'right'] : ['left', 'topL', 'topR', 'right']
}

function draw(el: HTMLElement, s: Session, state: GameState, me: string, refresh: () => void): void {
  const scroll = el.querySelector('.ct__scroll')?.scrollTop ?? 0
  el.replaceChildren()
  const midRound = s.meta.status === 'playing'
  const inLobby = s.meta.status === 'lobby' || !s.pub
  const ctx: ViewCtx = { session: s, me, state, send: (m) => void sendMove(m), refresh, pending: cardTable.pending }
  const parts: ViewParts | null = inLobby ? null : VIEWS[s.meta.game](ctx)

  // Thanh trên: tên game, mức cược, đồng hồ, trợ giúp, rời bàn.
  const top = document.createElement('div')
  top.className = 'ct__top'
  const title = document.createElement('div')
  title.className = 'ct__title'
  title.innerHTML = '<strong></strong><span></span>'
  title.querySelector('strong')!.textContent = `🃏 ${tKey(`cards.game.${s.meta.game}`)}`
  title.querySelector('span')!.textContent = t('cards.stakeLine', { stake: s.meta.stake })
  const tools = document.createElement('div')
  tools.className = 'ct__tools'
  const deadline = (s.pub?.deadline as number | undefined) ?? 0
  if (deadline > 0 && midRound) {
    const timer = document.createElement('span')
    timer.className = 'ct__timer'
    timer.dataset.deadline = String(deadline)
    tools.append(timer)
  }
  const help = document.createElement('button')
  help.className = 'btn small' + (showHelp ? ' is-active' : '')
  help.textContent = '❓'
  help.addEventListener('click', () => {
    showHelp = !showHelp
    refresh()
  })
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
  tools.append(help, leave)
  top.append(title, tools)
  el.append(top)

  if (showHelp) {
    const box = document.createElement('div')
    box.className = 'ct__help'
    box.textContent = tKey(`cards.rule.${s.meta.game}`)
    el.append(box)
  }

  // Mặt bàn.
  const others = s.seats.filter((x) => x.uid !== me).sort((a, b) => {
    const order = (s.pub?.order as string[] | undefined) ?? s.seats.map((x) => x.uid)
    const n = order.length
    const ia = (order.indexOf(a.uid) - order.indexOf(me) + n) % n
    const ib = (order.indexOf(b.uid) - order.indexOf(me) + n) % n
    return ia - ib
  })
  const felt = document.createElement('div')
  const flat = !!parts?.flat
  felt.className = 'ct__felt' + (flat ? ' ct__felt--flat' : others.length >= 2 ? ' ct__felt--sides' : '')
  const center = document.createElement('div')
  center.className = flat ? 'ct__scroll' : 'ct__center'
  if (flat) {
    const strip = document.createElement('div')
    strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center'
    for (const seat of s.seats) strip.append(seatEl(s, seat.uid, parts?.seat?.(seat.uid) ?? {}, true))
    felt.append(strip)
  } else {
    const pos = positions(others.length)
    others.forEach((seat, i) => {
      const e = seatEl(s, seat.uid, parts?.seat?.(seat.uid) ?? {}, false)
      e.classList.add(`seat--${pos[i]}`)
      felt.append(e)
    })
    if (inLobby) {
      const p = document.createElement('p')
      p.className = 'ct__hint'
      p.textContent = s.isHost ? t('cards.hostWait', { n: s.seats.length, min: s.engine.min, max: s.engine.max }) : t('cards.guestWait')
      center.append(p)
    } else {
      center.append(...(parts?.center ?? []))
    }
    const pot = document.createElement('div')
    pot.className = 'ct__pot'
    pot.textContent = `🪙 ${t('cards.stakeLine', { stake: s.meta.stake })}`
    felt.append(pot)
  }
  if (flat) {
    el.append(felt, center)
    center.append(...(parts?.center ?? []))
  } else {
    felt.append(center)
    el.append(felt)
  }

  // Phần của mình: ghế, dải hướng dẫn, tay bài, nút.
  const mine = document.createElement('div')
  mine.className = 'ct__me'
  const meSeat = s.seats.find((x) => x.uid === me)
  if (!flat && meSeat) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;justify-content:center'
    row.append(seatEl(s, me, parts?.seat?.(me) ?? {}, true))
    mine.append(row)
  }
  if (parts?.banner) mine.append(parts.banner)
  if (parts?.extra) mine.append(...parts.extra)
  if (parts?.hand) mine.append(parts.hand)
  const actions = document.createElement('div')
  actions.className = 'ct__actions'
  if (parts) actions.append(...parts.actions)
  if (s.isHost && s.meta.status !== 'playing') {
    const go = document.createElement('button')
    go.className = 'btn primary big'
    go.disabled = s.seats.length < s.engine.min
    go.textContent = s.meta.status === 'done' ? `🔁 ${t('cards.again')}` : `▶ ${t('cards.start')}`
    go.addEventListener('click', () => void startRound())
    actions.append(go)
  }
  if (actions.childElementCount) mine.append(actions)
  const emotes = document.createElement('div')
  emotes.className = 'ct__emotes'
  for (const e of EMOTES) {
    const b = document.createElement('button')
    b.textContent = e
    b.addEventListener('click', () => void sendEmote(e))
    emotes.append(b)
  }
  mine.append(emotes)
  el.append(mine)

  // Bảng kết quả khi ván xong.
  const key = `${s.tid}:${s.meta.round}`
  if (s.meta.status === 'done' && s.meta.results && dismissed !== key) el.append(resultOverlay(s, me, key, refresh))
  const sc = el.querySelector('.ct__scroll')
  if (sc) sc.scrollTop = scroll
  updateTimers()
  void animate
}

function resultOverlay(s: Session, me: string, key: string, refresh: () => void): HTMLElement {
  const results = s.meta.results ?? {}
  const mineGold = results[me] ?? 0
  const win = mineGold > 0
  const wrap = document.createElement('div')
  wrap.className = 'ct__result'
  const box = document.createElement('div')
  box.className = 'ct__result-box' + (mineGold < 0 ? ' is-lose' : '')
  const title = document.createElement('p')
  title.className = 'ct__result-title'
  title.textContent = win ? `🎉 ${t('cards.resultWin')}` : mineGold < 0 ? `😢 ${t('cards.resultLose')}` : `🤝 ${t('cards.resultDraw')}`
  const gold = document.createElement('p')
  gold.className = 'ct__result-gold ' + (mineGold >= 0 ? 'is-up' : 'is-down')
  gold.textContent = `${mineGold >= 0 ? '+' : ''}${mineGold} 🪙`
  box.append(title, gold)
  for (const seat of [...s.seats].sort((a, b) => (results[b.uid] ?? 0) - (results[a.uid] ?? 0))) {
    const v = results[seat.uid]
    if (v === undefined) continue
    const row = document.createElement('div')
    row.className = 'ct__rank' + (seat.uid === me ? ' is-me' : '')
    row.innerHTML = '<span></span><b></b>'
    row.querySelector('span')!.textContent = `${seat.uid === s.meta.host ? '👑 ' : ''}${seat.name}`
    const b = row.querySelector('b')!
    b.textContent = `${v >= 0 ? '+' : ''}${v}`
    b.className = v >= 0 ? 'is-up' : 'is-down'
    box.append(row)
  }
  const actions = document.createElement('div')
  actions.className = 'ct__result-actions'
  const view = document.createElement('button')
  view.className = 'btn'
  view.textContent = t('cards.viewTable')
  view.addEventListener('click', () => {
    dismissed = key
    refresh()
  })
  actions.append(view)
  if (s.isHost) {
    const again = document.createElement('button')
    again.className = 'btn primary'
    again.textContent = `🔁 ${t('cards.again')}`
    again.addEventListener('click', () => {
      dismissed = key
      void startRound()
    })
    actions.append(again)
  }
  box.append(actions)
  wrap.append(box)
  if (win) {
    const conf = document.createElement('div')
    conf.className = 'confetti'
    for (let i = 0; i < 22; i++) {
      const sp = document.createElement('span')
      sp.textContent = ['🪙', '✨', '🎉'][i % 3]
      sp.style.setProperty('--x', `${(i * 47) % 100}%`)
      sp.style.setProperty('--d', `${2 + (i % 5) * 0.4}s`)
      sp.style.setProperty('--w', `${(i % 7) * 0.25}s`)
      sp.style.setProperty('--s', `${18 + (i % 4) * 4}px`)
      conf.append(sp)
    }
    wrap.append(conf)
  }
  return wrap
}
