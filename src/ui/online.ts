import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { ONLINE_WINDOW_MS, type Profile } from '../online/cloud.ts'
import { cancelRequest, connect, onlineDisabled, setOnlineDisabled, giveToRequest, GUEST_LINES, notifyError, online, refreshFriends, sendGift, sendNote } from '../online/online.ts'
import type { ParsedSave } from '../save/format.ts'
import { giftable } from '../systems/friendship.ts'
import { countItem, removeItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'
import { closePanel, openPanel } from './panel.ts'
import { leaderboardPanel } from './leaderboard.ts'
import { openTradeComposer, renderTrades } from './trade.ts'

/** Bản trên mây mới hơn bản trên máy (chơi ở máy khác): hỏi dùng bản nào. */
export function askUseCloud(save: ParsedSave): Promise<boolean> {
  return new Promise((resolve) => {
    openPanel({
      title: () => `☁️ ${t('online.cloudTitle')}`,
      modal: true,
      render(body) {
        const p = document.createElement('p')
        p.className = 'menu-note'
        p.textContent = t('online.cloudNewer', { time: new Date(save.savedAt).toLocaleString(), name: save.state.player.name, level: save.state.player.level })
        const row = document.createElement('div')
        row.className = 'menu-actions'
        const use = button(`☁️ ${t('online.useCloud')}`, 'btn primary', () => {
          closePanel()
          resolve(true)
        })
        const keep = button(`📱 ${t('online.keepLocal')}`, 'btn', () => {
          closePanel()
          resolve(false)
        })
        row.append(use, keep)
        body.append(p, row)
      },
    })
  })
}

/** Phần "Chơi cùng bạn bè" trong cửa sổ Bạn bè. */
export function renderOnline(body: HTMLElement, state: GameState, refresh: () => void, ui: { gifting: string | null; code: string; confirmDelete?: boolean }): void {
  const box = document.createElement('section')
  box.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = `🌐 ${t('online.title')}`
  box.append(h)
  body.append(box)

  if (onlineDisabled()) {
    box.append(note(t('online.disabled')))
    box.append(button(`🌐 ${t('online.enable')}`, 'btn primary', () => {
      setOnlineDisabled(false)
      location.reload()
    }))
    return
  }
  if (online.status === 'connecting' || online.status === 'off') {
    box.append(note(t('online.connecting')))
    return
  }
  if (online.status === 'error') {
    box.append(note(t(online.error === 'setup' ? 'online.error.setup' : 'online.error.offline')))
    box.append(button(`🔄 ${t('online.retry')}`, 'btn', () => {
      void connect().then(() => location.reload(), refresh)
    }))
    return
  }

  const cloud = online.cloud!
  const acc = cloud.account
  // Mã bạn bè và tài khoản.
  box.append(note(t('online.myCode', { code: state.meta.inviteCode })))
  const accRow = document.createElement('div')
  accRow.className = 'menu-actions'
  accRow.append(button(`📋 ${t('online.copyCode')}`, 'btn', () => {
    void navigator.clipboard.writeText(state.meta.inviteCode).then(() => bus.emit('notify', { key: 'social.copied', good: true }), () => {})
  }))
  if (acc.anonymous) {
    accRow.append(button(`🔑 ${t('online.google')}`, 'btn gold', () => {
      void cloud.signInGoogle().then(
        // Đổi sang tài khoản đã chơi ở máy khác: tải lại để lấy bản lưu trên mây.
        (r) => (r === 'switched' ? location.reload() : refresh()),
        (e: unknown) => notifyError(e),
      )
    }))
  }
  accRow.append(button(`🏆 ${t('rank.title')}`, 'btn', () => openPanel(leaderboardPanel(state))))
  box.append(accRow)
  box.append(note(acc.anonymous ? t('online.anonHint') : t('online.signedIn', { email: acc.email ?? 'Google' })))

  // Kết bạn bằng mã.
  const addRow = document.createElement('div')
  addRow.className = 'menu-actions'
  const input = document.createElement('input')
  input.className = 'menu-input'
  input.placeholder = t('online.codePlaceholder')
  input.maxLength = 12
  input.value = ui.code
  input.addEventListener('input', () => (ui.code = input.value))
  const add = button(`➕ ${t('online.addFriend')}`, 'btn primary', () => {
    const code = input.value.trim()
    if (!code) return
    add.disabled = true
    void cloud.addFriend(code).then(
      (p) => {
        ui.code = ''
        bus.emit('notify', { key: 'online.friendAdded', params: { name: p.name }, good: true })
        void refreshFriends().then(refresh)
      },
      (e: unknown) => {
        notifyError(e)
        add.disabled = false
      },
    )
  })
  addRow.append(input, add)
  box.append(addRow)

  // Danh sách bạn.
  if (online.friends.length === 0) box.append(note(t('online.noFriends')))
  for (const f of online.friends) box.append(friendRow(state, f, refresh, ui))

  renderTrades(body, state, refresh)
  renderRequests(body, state, refresh)
  renderGuestbook(body, state)

  // Xoá dữ liệu online của mình (bấm hai lần để chắc chắn); nông trại trên máy vẫn giữ.
  const del = button(ui.confirmDelete ? `⚠️ ${t('online.deleteConfirm')}` : `🗑️ ${t('online.delete')}`, 'btn small', () => {
    if (!ui.confirmDelete) {
      ui.confirmDelete = true
      refresh()
      return
    }
    del.disabled = true
    void cloud.deleteMyData(state.meta.inviteCode).then(
      () => {
        // Tắt online trên máy này để lần lưu sau không tạo lại dữ liệu vừa xoá.
        setOnlineDisabled(true)
        bus.emit('notify', { key: 'online.deleted', good: true })
        setTimeout(() => location.reload(), 1200)
      },
      (e: unknown) => notifyError(e),
    )
  })
  body.append(del)
}

/** Bạn bè cần giúp (gửi đồ trong túi, được thưởng) và lời nhờ của chính mình. */
function renderRequests(body: HTMLElement, state: GameState, refresh: () => void): void {
  const me = online.cloud?.account.uid
  const mine = online.requests.find((r) => r.uid === me)
  const others = online.requests.filter((r) => r.uid !== me)
  if (!mine && others.length === 0) return
  const box = document.createElement('section')
  box.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = `🙋 ${t('request.title')}`
  box.append(h)
  if (mine) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span class="row-icon">${itemIconHtml(mine.item)}</span><span class="row-main"><strong></strong><span class="muted"></span></span>`
    row.querySelector('strong')!.textContent = t('request.mine', { qty: mine.qty, item: itemName(mine.item) })
    row.querySelector('.muted')!.textContent = t('request.progress', { have: mine.have, qty: mine.qty })
    row.append(button(t('request.cancel'), 'btn small', () => void cancelRequest().then(refresh)))
    box.append(row)
  }
  for (const r of others) {
    const have = countItem(state.inventory, r.item)
    const n = Math.min(r.qty - r.have, have)
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span class="row-icon">${itemIconHtml(r.item)}</span><span class="row-main"><strong></strong><span class="muted"></span></span>`
    row.querySelector('strong')!.textContent = t('request.needs', { name: r.name, qty: r.qty, item: itemName(r.item) })
    row.querySelector('.muted')!.textContent = `${t('request.progress', { have: r.have, qty: r.qty })} · ${t('request.youHave', { n: have })}`
    const give = button(n > 0 ? t('request.give', { n }) : t('request.none'), 'btn small gold', () => {
      give.disabled = true
      void giveToRequest(state, r).then(refresh)
    })
    give.disabled = n <= 0
    row.append(give)
    box.append(row)
  }
  body.append(box)
}

/** Sổ khách: bạn bè ghé thăm để lại câu chúc. */
function renderGuestbook(body: HTMLElement, state: GameState): void {
  if (state.guestbook.length === 0) return
  const box = document.createElement('section')
  box.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = `📖 ${t('guest.title')}`
  box.append(h)
  for (const g of state.guestbook.slice(0, 8)) {
    box.append(note(`${g.from}: ${tKey(g.text)} · ${new Date(g.at).toLocaleDateString()}`))
  }
  body.append(box)
}

/** Đang thăm bạn: chọn một câu chúc để ghi vào sổ khách. */
export function guestbookPanel(fromName: string, friendUid: string, friendName: string): void {
  openPanel({
    title: () => `✍️ ${t('guest.title')}`,
    render(body) {
      body.append(note(t('guest.pick', { name: friendName })))
      const list = document.createElement('div')
      list.className = 'guest-lines'
      for (let i = 1; i <= GUEST_LINES; i++) {
        const key = `guest.p${i}`
        list.append(button(tKey(key), 'btn', () => {
          closePanel()
          void sendNote(fromName, friendUid, friendName, key)
        }))
      }
      body.append(list)
    },
  })
}

function friendRow(state: GameState, f: Profile, refresh: () => void, ui: { gifting: string | null }): HTMLElement {
  const wrap = document.createElement('div')
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji">🧑‍🌾</span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('strong')!.textContent = `${Date.now() - f.lastSeen < ONLINE_WINDOW_MS ? '🟢 ' : ''}${f.name}`
  row.querySelector('.muted')!.textContent = Date.now() - f.lastSeen < ONLINE_WINDOW_MS ? t('online.playingNow', { level: f.level }) : t('online.friendSub', { level: f.level, ago: ago(f.lastSeen) })
  row.append(
    button(`🏡 ${t('online.visit')}`, 'btn small primary', () => {
      location.href = `${location.pathname}#friend=${encodeURIComponent(f.uid)}`
    }),
    button('🔄', 'btn small', () => openTradeComposer(state, f, refresh)),
    button('🎁', 'btn small gold', () => {
      ui.gifting = ui.gifting === f.uid ? null : f.uid
      refresh()
    }),
  )
  wrap.append(row)
  if (ui.gifting === f.uid) {
    const pick = document.createElement('div')
    pick.className = 'gift-pick'
    const ids = giftable(state)
    if (ids.length === 0) pick.textContent = t('friend.nothing')
    for (const id of ids) {
      const b = document.createElement('button')
      b.className = 'slot gift-pick__item'
      b.innerHTML = itemIconHtml(id)
      b.title = itemName(id)
      b.addEventListener('click', () => {
        void sendGift(state, f, id).then((ok) => {
          if (ok) {
            removeItem(state.inventory, id, 1)
            bus.emit('saveRequest', undefined)
            ui.gifting = null
          }
          refresh()
        })
      })
      pick.append(b)
    }
    wrap.append(pick)
  }
  return wrap
}

/** "5 phút trước", "2 giờ trước", "3 ngày trước". */
function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (min < 60) return t('online.agoMin', { n: min })
  if (min < 60 * 24) return t('online.agoHour', { n: Math.round(min / 60) })
  return t('online.agoDay', { n: Math.round(min / 1440) })
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-note'
  p.textContent = text
  return p
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
