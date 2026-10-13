import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import { t } from '../i18n/index.ts'
import { isReady, updateAnimals } from './animals.ts'
import { isRipe, updateCrops } from './farming.ts'
import { treeStatus } from './orchard.ts'

/**
 * Thông báo trên máy khi game đang chạy nền (tab ẩn, app thu nhỏ): cây chín, vật nuôi
 * có sản phẩm, máy chế biến xong, cây ra quả. Không có máy chủ nên khi đã đóng hẳn
 * app thì không báo được; trình duyệt cũng chỉ cho hẹn giờ thưa (khoảng mỗi phút).
 */

const CHECK_MS = 60_000

export function notifySupported(): boolean {
  return 'Notification' in window
}

/** Bật thông báo: xin quyền (cần thao tác của người chơi). */
export async function enableNotifications(state: GameState): Promise<boolean> {
  if (!notifySupported()) return false
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  state.settings.notify = perm === 'granted'
  return state.settings.notify
}

interface Counts {
  ripe: number
  animals: number
  machines: number
  trees: number
}

/** Đếm những thứ đã xong tại thời điểm t, tính trên bản sao để không đụng trạng thái thật. */
function readyCounts(state: GameState, t: number, since: number): Counts {
  const s = structuredClone(state)
  updateCrops(s, t, since)
  updateAnimals(s, t, since)
  return {
    ripe: s.plots.filter(isRipe).length,
    animals: s.animals.filter(isReady).length,
    machines: s.machines.filter((m) => m.output && t >= m.readyAt).length,
    trees: s.orchard.filter((tree) => treeStatus(s, tree, t) === 'fruit').length,
  }
}

export function attachNotifications(state: GameState): void {
  let timer = 0
  let base: Counts | null = null
  let hiddenAt = 0

  const check = () => {
    if (!document.hidden || !state.settings.notify || Notification.permission !== 'granted' || !base) return
    const c = readyCounts(state, now(), hiddenAt)
    const lines: string[] = []
    if (c.ripe > base.ripe) lines.push(t('notify.ripe', { n: c.ripe }))
    if (c.animals > base.animals) lines.push(t('notify.animals', { n: c.animals }))
    if (c.machines > base.machines) lines.push(t('notify.machines', { n: c.machines }))
    if (c.trees > base.trees) lines.push(t('notify.trees', { n: c.trees }))
    if (lines.length === 0) return
    // Báo một lần cho mỗi lượt thay đổi.
    base = c
    void show(lines.join('\n'))
  }

  document.addEventListener('visibilitychange', () => {
    clearInterval(timer)
    if (document.hidden && state.settings.notify) {
      hiddenAt = now()
      base = readyCounts(state, hiddenAt, hiddenAt)
      timer = window.setInterval(check, CHECK_MS)
    } else {
      base = null
    }
  })
}

async function show(body: string): Promise<void> {
  const options: NotificationOptions = { body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: 'noah-farm' }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) await reg.showNotification('Noah Farm', options)
    else new Notification('Noah Farm', options)
  } catch {
    // Một số trình duyệt chặn thông báo; game vẫn chạy bình thường.
  }
}
