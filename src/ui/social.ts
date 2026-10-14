import { renderSVG } from 'uqr'
import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import { encodeFarm, inviteUrl, MAX_SHARE_CHARS, shareUrl } from '../save/share.ts'
import { checkAchievements } from '../systems/quests.ts'
import type { PanelSpec } from './panel.ts'
import { refreshFriends, refreshRequests } from '../online/online.ts'
import { refreshTrades } from '../online/trade.ts'
import { renderOnline } from './online.ts'

/**
 * Bạn bè (GDD mục 8): link khoe nông trại (#visit=…) kèm mã QR, và link mời bạn mới (?ref=…).
 * Không có server: link chỉ là ảnh chụp nông trại lúc tạo, muốn bạn thấy cảnh mới thì gửi lại link.
 */
export function createSocialPanel(state: GameState): PanelSpec {
  let link = ''
  let making = false

  const shared = () => {
    state.stats.shared = (state.stats.shared ?? 0) + 1
    checkAchievements(state)
    bus.emit('saveRequest', undefined)
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      bus.emit('notify', { key: 'social.copied', good: true })
    } catch {
      bus.emit('notify', { key: 'social.copyFailed' })
    }
    shared()
  }

  const onlineUi = { gifting: null as string | null, code: '' }
  let shownOnce = false
  return {
    title: () => `🤝 ${t('social.title')}`,
    render(body, refresh) {
      // Chơi cùng bạn bè (Firebase); mở cửa sổ thì cập nhật danh sách bạn.
      if (!shownOnce) {
        shownOnce = true
        void refreshFriends().then(refreshRequests).then(() => refreshTrades(state)).then(refresh)
        bus.on('onlineChanged', () => refresh())
      }
      renderOnline(body, state, refresh, onlineUi)

      // Khoe nông trại.
      const visit = section(body, t('social.visitTitle'))
      visit.append(note(t('social.visitHint', { name: state.player.name })))
      if (!link) {
        if (!making) {
          making = true
          void encodeFarm(state).then((data) => {
            link = shareUrl(data)
            making = false
            refresh()
          })
        }
        visit.append(note('…'))
      } else {
        visit.append(field(link))
        const row = document.createElement('div')
        row.className = 'menu-actions'
        row.append(button(`🔗 ${t('social.copy')}`, 'btn primary', () => void copy(link)))
        if (navigator.share) {
          row.append(
            button(`📤 ${t('social.share')}`, 'btn', () => {
              navigator.share({ title: 'Noah Farm', text: t('social.shareText', { name: state.player.name }), url: link }).then(shared, () => {})
            }),
          )
        }
        row.append(button(`🔄 ${t('social.refresh')}`, 'btn', () => {
          link = ''
          refresh()
        }))
        visit.append(row)
        const qr = document.createElement('div')
        qr.className = 'qr'
        qr.innerHTML = renderSVG(link, { ecc: 'L', pixelSize: 3, whiteColor: '#fffdf6', blackColor: '#4e2a0c' })
        visit.append(qr)
        visit.append(note(t('social.size', { n: link.length, max: MAX_SHARE_CHARS })))
      }

      // Mời bạn mới.
      const invite = section(body, t('social.inviteTitle'))
      const inv = inviteUrl(state.meta.inviteCode)
      invite.append(note(t('social.inviteHint')), field(inv))
      const row = document.createElement('div')
      row.className = 'menu-actions'
      row.append(button(`🎁 ${t('social.copyInvite')}`, 'btn gold', () => void copy(inv)))
      invite.append(row)
    },
  }
}

function section(body: HTMLElement, title: string): HTMLElement {
  const el = document.createElement('section')
  el.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = title
  el.append(h)
  body.append(el)
  return el
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-status'
  p.textContent = text
  return p
}

function field(value: string): HTMLTextAreaElement {
  const input = document.createElement('textarea')
  input.className = 'menu-code'
  input.readOnly = true
  input.value = value
  input.addEventListener('focus', () => input.select())
  return input
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
