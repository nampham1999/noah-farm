import type { SaveStore } from '../save/SaveStore.ts'
import type { AutoSaver } from '../save/autosave.ts'
import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import { adoptSyncCode, notifyError } from '../online/online.ts'
import { closePanel, openPanel } from './panel.ts'

export const PENDING_SYNC_KEY = 'noahfarm.pendingSync'
const HASH_RE = /[#&]sync=([a-z0-9]{20,40})/i

/** Link đồng bộ (#sync=mã, quét từ mã QR hoặc dán vào trình duyệt): ghi nhớ mã rồi xoá khỏi thanh địa chỉ. Trả về true nếu có mã. */
export function captureSyncLink(): boolean {
  const m = HASH_RE.exec(location.hash)
  if (!m) return false
  try {
    sessionStorage.setItem(PENDING_SYNC_KEY, m[1].toLowerCase())
  } catch {
    return false
  }
  history.replaceState(null, '', location.pathname + location.search)
  return true
}

/** Nếu đang có mã đồng bộ chờ từ link/QR thì hỏi người chơi có dùng không (dữ liệu trên máy này sẽ được thay). */
export function askAdoptPending(state: GameState, store: SaveStore, autosaver: AutoSaver): void {
  let code: string | null = null
  try {
    code = sessionStorage.getItem(PENDING_SYNC_KEY)
    sessionStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    return
  }
  if (!code) return
  const pending = code
  let busy = false
  let msg = ''
  openPanel({
    title: () => `🔗 ${t('sync.adoptTitle')}`,
    modal: true,
    render(body, refresh) {
      const p = document.createElement('p')
      p.className = 'welcome-hello'
      p.textContent = msg || t('sync.adoptText')
      body.append(p)
      const row = document.createElement('div')
      row.className = 'welcome-actions'
      const yes = document.createElement('button')
      yes.className = 'btn primary big'
      yes.disabled = busy
      yes.textContent = `🔗 ${t('sync.adoptYes')}`
      yes.addEventListener('click', () => {
        busy = true
        refresh()
        void adoptSyncCode(state, store, autosaver, pending).then(
          (r) => {
            if (r === 'downloaded') return
            msg = r === 'created' ? t('sync.created') : r === 'invalid' ? t('sync.invalid') : t('cards.offline')
            busy = false
            refresh()
          },
          (e: unknown) => {
            busy = false
            notifyError(e)
            refresh()
          },
        )
      })
      const no = document.createElement('button')
      no.className = 'btn'
      no.textContent = t('sync.skip')
      no.addEventListener('click', closePanel)
      row.append(yes, no)
      body.append(row)
    },
  })
}
