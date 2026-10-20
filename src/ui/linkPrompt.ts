import type { GameState } from '../core/state.ts'
import { bus } from '../core/events.ts'
import { t } from '../i18n/index.ts'
import { notifyError, online } from '../online/online.ts'
import { authErrorText } from './online.ts'
import { closePanel, isPanelOpen, openPanel } from './panel.ts'

const ASKED_KEY = 'noahfarm.linkAsked'
const FIRST_DELAY_MS = 15 * 60_000
const RETRY_MS = 5 * 60_000
const REASK_MS = 3 * 86_400_000

/** Chơi một lúc mà vẫn là tài khoản ẩn danh: nhắc liên kết Google để giữ tiến trình và chơi nhiều máy (nhắc lại sau 3 ngày nếu chọn "để sau"). */
export function scheduleLinkPrompt(state: GameState): void {
  const tryAsk = () => {
    const cloud = online.cloud
    if (!cloud || !cloud.account.anonymous) return
    let last = 0
    try {
      last = Number(localStorage.getItem(ASKED_KEY) ?? 0)
    } catch {
      /* không đọc được: coi như chưa hỏi */
    }
    if (Date.now() - last < REASK_MS) return
    if (isPanelOpen()) return void window.setTimeout(tryAsk, RETRY_MS)
    ask(state)
  }
  window.setTimeout(tryAsk, FIRST_DELAY_MS)
}

function ask(state: GameState): void {
  let error = ''
  const later = () => {
    try {
      localStorage.setItem(ASKED_KEY, String(Date.now()))
    } catch {
      /* bỏ qua */
    }
    closePanel()
  }
  openPanel({
    title: () => `🔑 ${t('link.title')}`,
    onClose: later,
    render(body, refresh) {
      const p = document.createElement('p')
      p.className = 'welcome-hello'
      p.textContent = t('link.text')
      body.append(p)
      if (error) {
        const e = document.createElement('p')
        e.className = 'menu-note'
        e.style.color = '#b3321f'
        e.textContent = error
        body.append(e)
      }
      const row = document.createElement('div')
      row.className = 'welcome-actions'
      const yes = document.createElement('button')
      yes.className = 'btn gold big'
      yes.textContent = `🔑 ${t('link.yes')}`
      yes.addEventListener('click', () => {
        error = ''
        void online.cloud!.signInGoogle().then(
          (r) => {
            if (r === 'switched') return location.reload()
            bus.emit('saveRequest', undefined)
            later()
          },
          (e: unknown) => {
            error = authErrorText(e)
            notifyError(e)
            refresh()
          },
        )
      })
      const no = document.createElement('button')
      no.className = 'btn'
      no.textContent = t('link.later')
      no.addEventListener('click', later)
      row.append(yes, no)
      body.append(row)
      void state
    },
  })
}
