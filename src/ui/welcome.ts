import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { getLang, setLang, t } from '../i18n/index.ts'
import { connect, notifyError } from '../online/online.ts'
import { gunzipBase64Url } from '../save/codec.ts'
import type { SaveStore } from '../save/SaveStore.ts'
import { closePanel, openPanel } from './panel.ts'

/**
 * Màn hình chào người chơi mới (chưa có bản lưu trên máy):
 * - Đăng nhập Google: tài khoản đã có nông trại trên mây thì tải về chơi tiếp.
 * - Chơi ngay (khách): đăng nhập ẩn danh, sau này vẫn gắn Google được.
 * Rồi đặt tên nông dân. Trả về 'reload' nếu đã thay bản lưu và đang tải lại trang.
 */
export function showWelcome(state: GameState, store: SaveStore): Promise<'play' | 'reload'> {
  // Kết nối sẵn để lúc bấm Google cửa sổ đăng nhập mở ngay (trình duyệt chặn popup mở trễ).
  const ready = connect().catch(() => null)
  let name = ''
  let busy = false

  return new Promise((resolve) => {
    const finish = () => {
      const trimmed = name.trim().slice(0, 20)
      if (trimmed) state.player.name = trimmed
      closePanel()
      bus.emit('saveRequest', undefined)
      resolve('play')
    }

    openPanel({
      title: () => '🌱 Noah Farm',
      modal: true,
      render(body, refresh) {
        const hello = document.createElement('p')
        hello.className = 'welcome-hello'
        hello.textContent = t('welcome.hello')
        body.append(hello)

        // Tên nông dân.
        const label = document.createElement('label')
        label.className = 'welcome-label'
        label.textContent = t('welcome.name')
        const input = document.createElement('input')
        input.className = 'menu-input'
        input.maxLength = 20
        input.placeholder = state.player.name
        input.value = name
        input.addEventListener('input', () => (name = input.value))
        label.append(input)
        body.append(label)

        const actions = document.createElement('div')
        actions.className = 'welcome-actions'
        const play = button(`▶️ ${t('welcome.play')}`, 'btn primary big', finish)
        const google = button(`🔑 ${t('welcome.google')}`, 'btn gold big', () => {
          if (busy) return
          busy = true
          refresh()
          void signInGoogle().then((r) => {
            busy = false
            if (r === 'reload') return resolve('reload')
            if (r === 'new') finish()
            else refresh()
          })
        })
        play.disabled = google.disabled = busy
        actions.append(google, play)
        body.append(actions)

        const hint = document.createElement('p')
        hint.className = 'menu-note'
        hint.textContent = t('welcome.hint')
        body.append(hint)

        const lang = button(`🌐 ${getLang() === 'vi' ? 'English' : 'Tiếng Việt'}`, 'btn small', () => {
          state.settings.lang = getLang() === 'vi' ? 'en' : 'vi'
          setLang(state.settings.lang)
          bus.emit('langChanged', state.settings.lang)
        })
        body.append(lang)
      },
    })

    /** 'reload': đã lấy nông trại trên mây; 'new': tài khoản mới, chơi từ đầu; 'failed': lỗi. */
    async function signInGoogle(): Promise<'reload' | 'new' | 'failed'> {
      const cloud = await ready
      if (!cloud) {
        bus.emit('notify', { key: 'online.error.setup' })
        return 'failed'
      }
      try {
        const r = await cloud.signInGoogle()
        if (r === 'switched') {
          const remote = await cloud.downloadSave()
          if (remote) {
            await store.replace(await gunzipBase64Url(remote.data))
            bus.emit('notify', { key: 'welcome.restored', good: true })
            setTimeout(() => location.reload(), 600)
            return 'reload'
          }
        }
        bus.emit('notify', { key: 'welcome.signedIn', good: true })
        return 'new'
      } catch (e) {
        notifyError(e)
        return 'failed'
      }
    }
  })
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
