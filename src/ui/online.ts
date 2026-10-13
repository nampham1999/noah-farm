import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { itemName, t } from '../i18n/index.ts'
import type { Profile } from '../online/cloud.ts'
import { connect, notifyError, online, refreshFriends, sendGift } from '../online/online.ts'
import type { ParsedSave } from '../save/format.ts'
import { giftable } from '../systems/friendship.ts'
import { removeItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'
import { closePanel, openPanel } from './panel.ts'

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
export function renderOnline(body: HTMLElement, state: GameState, refresh: () => void, ui: { gifting: string | null; code: string }): void {
  const box = document.createElement('section')
  box.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = `🌐 ${t('online.title')}`
  box.append(h)
  body.append(box)

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
}

function friendRow(state: GameState, f: Profile, refresh: () => void, ui: { gifting: string | null }): HTMLElement {
  const wrap = document.createElement('div')
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji">🧑‍🌾</span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  row.querySelector('strong')!.textContent = f.name
  row.querySelector('.muted')!.textContent = t('online.friendSub', { level: f.level, ago: ago(f.lastSeen) })
  row.append(
    button(`🏡 ${t('online.visit')}`, 'btn small primary', () => {
      location.href = `${location.pathname}#friend=${encodeURIComponent(f.uid)}`
    }),
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
