import { t } from '../i18n/index.ts'
import { openPanel } from './panel.ts'

/** Tài khoản đang được chơi ở thiết bị khác: chặn máy này lại, cho chọn chơi tiếp ở đây (máy kia sẽ bị dừng). */
export function showSessionLost(reclaim: () => Promise<void>): void {
  let busy = false
  openPanel({
    title: () => `📱 ${t('session.title')}`,
    modal: true,
    render(body, refresh) {
      const p = document.createElement('p')
      p.className = 'welcome-hello'
      p.textContent = busy ? t('session.loading') : t('session.text')
      body.append(p)
      const b = document.createElement('button')
      b.className = 'btn primary big'
      b.disabled = busy
      b.textContent = `▶️ ${t('session.here')}`
      b.addEventListener('click', () => {
        busy = true
        refresh()
        void reclaim()
      })
      body.append(b)
    },
  })
}
