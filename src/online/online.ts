import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import type { AutoSaver } from '../save/autosave.ts'
import { gunzipBase64Url, gzipBase64Url } from '../save/codec.ts'
import { parseSave, serialize, type ParsedSave } from '../save/format.ts'
import type { SaveStore } from '../save/SaveStore.ts'
import { needsWater } from '../systems/farming.ts'
import { addItem, canFit } from '../systems/inventory.ts'
import { gainXp } from '../systems/progress.ts'
import { Cloud, CloudError, type CloudErrorCode, type Profile } from './cloud.ts'

/**
 * Chơi cùng bạn bè qua Firebase: lưu đám mây, mã bạn bè, thăm nông trại bạn (bản mới nhất),
 * quà và tưới giúp mỗi ngày. Mất mạng hay chưa bật Firebase thì game vẫn chơi bình thường.
 */

export type OnlineStatus = 'off' | 'connecting' | 'on' | 'error'

/** Gửi bản lưu lên mây thưa nhất chừng này (ms). */
const UPLOAD_EVERY_MS = 60_000
const INBOX_EVERY_MS = 120_000
/** Bản trên mây mới hơn bản trên máy quá chừng này thì hỏi người chơi. */
const NEWER_MS = 10_000
/** Tưới giúp: số ô tối đa mỗi lượt, và thưởng cho người tưới. */
const HELP_PLOTS = 5
const HELP_GOLD = 20
const HELP_XP = 5
/** Thưởng tưới giúp chờ nhận (ghi lúc đang thăm, cộng khi về nông trại mình). */
const PENDING_KEY = 'noahfarm.helpReward'

export const online = {
  status: 'off' as OnlineStatus,
  error: null as CloudErrorCode | null,
  cloud: null as Cloud | null,
  friends: [] as Profile[],
  /** Lần gửi bản lưu lên mây gần nhất (0 là chưa). */
  uploadedAt: 0,
}

function setStatus(status: OnlineStatus, error: CloudErrorCode | null = null): void {
  online.status = status
  online.error = error
  bus.emit('onlineChanged', undefined)
}

function randomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function encodeSave(state: GameState, savedAt: number): Promise<string> {
  return gzipBase64Url(serialize(state, savedAt))
}

export async function decodeSave(data: string): Promise<ParsedSave> {
  return parseSave(await gunzipBase64Url(data))
}

/** Kết nối (dùng chung cho nông trại mình và lúc thăm bạn). */
export async function connect(): Promise<Cloud> {
  if (online.cloud) return online.cloud
  setStatus('connecting')
  try {
    online.cloud = await Cloud.connect()
    setStatus('on')
    return online.cloud
  } catch (e) {
    setStatus('error', e instanceof CloudError ? e.code : 'other')
    throw e
  }
}

/**
 * Bật online cho nông trại của mình: hồ sơ và mã bạn bè, so bản lưu trên mây,
 * tự gửi bản lưu lên sau mỗi lần lưu, đọc hộp thư định kỳ.
 */
export async function startOnline(state: GameState, store: SaveStore, autosaver: AutoSaver, localSavedAt: number, askUseCloud: (save: ParsedSave) => Promise<boolean>): Promise<void> {
  claimHelpReward(state)
  let cloud: Cloud
  try {
    cloud = await connect()
  } catch {
    return
  }

  try {
    await syncProfile(state)
    // Bản trên mây mới hơn (chơi ở máy khác): hỏi có dùng không.
    const remote = await cloud.downloadSave()
    if (remote && remote.savedAt > Math.max(localSavedAt, autosaver.lastSavedAt) + NEWER_MS) {
      const parsed = await decodeSave(remote.data)
      if (await askUseCloud(parsed)) {
        autosaver.suspend()
        await store.replace(await gunzipBase64Url(remote.data))
        location.reload()
        return
      }
    }
  } catch (e) {
    console.warn('Online sync failed', e)
  }

  // Gửi bản lưu lên sau khi lưu trên máy (thưa nhất mỗi phút), và một lần ngay bây giờ
  // để bạn bè thăm được bản mới nhất.
  let lastUpload = 0
  let uploading = false
  const upload = (savedAt: number) => {
    uploading = true
    lastUpload = savedAt
    void encodeSave(state, savedAt)
      .then((data) => cloud.uploadSave(data, savedAt))
      .then(() => {
        online.uploadedAt = savedAt
        return syncProfile(state)
      })
      .catch((e: unknown) => console.warn('Cloud upload failed', e))
      .finally(() => (uploading = false))
  }
  autosaver.onSaved = (savedAt) => {
    if (uploading || (savedAt - lastUpload < UPLOAD_EVERY_MS && document.visibilityState === 'visible')) return
    upload(savedAt)
  }
  // Lưu trên máy ngay (onSaved gửi lên mây cùng mốc thời gian, để lần sau không bị hỏi nhầm "bản mới hơn").
  void autosaver.saveNow()

  const checkInbox = () => void readInbox(state).catch((e: unknown) => console.warn('Inbox failed', e))
  checkInbox()
  window.setInterval(checkInbox, INBOX_EVERY_MS)
  void refreshFriends()
}

async function syncProfile(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud) return
  const code = await cloud.saveProfile({ name: state.player.name, level: state.player.level, look: state.player.look, code: state.meta.inviteCode }, randomCode)
  if (code !== state.meta.inviteCode) {
    state.meta.inviteCode = code
    bus.emit('saveRequest', undefined)
  }
}

export async function refreshFriends(): Promise<Profile[]> {
  if (!online.cloud) return []
  try {
    online.friends = await online.cloud.friends()
    bus.emit('onlineChanged', undefined)
  } catch (e) {
    console.warn('Friends failed', e)
  }
  return online.friends
}

/** Nhận quà và lượt tưới giúp bạn bè gửi tới. */
async function readInbox(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud) return
  const items = await cloud.takeInbox()
  for (const it of items) {
    if (it.kind === 'gift' && it.item && it.qty) {
      if (canFit(state.inventory, it.item, it.qty)) addItem(state.inventory, it.item, it.qty)
      bus.emit('notify', { key: 'online.gotGift', params: { name: it.fromName, item: it.item, qty: it.qty }, good: true })
    } else if (it.kind === 'help') {
      const t = now()
      const thirsty = state.plots.filter(needsWater).slice(0, HELP_PLOTS)
      for (const p of thirsty) p.wateredAt = t
      bus.emit('notify', { key: 'online.gotHelp', params: { name: it.fromName, n: thirsty.length }, good: true })
    }
  }
  if (items.length) bus.emit('saveRequest', undefined)
}

/** Tặng bạn một món trong túi (mỗi bạn mỗi ngày một lần). */
export async function sendGift(state: GameState, friend: Profile, itemId: string): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) return false
  try {
    await cloud.send(friend.uid, 'gift', state.player.name, itemId, 1)
  } catch (e) {
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'online.giftSent', params: { name: friend.name, item: itemId }, good: true })
  return true
}

/** Đang thăm nông trại bạn: tưới giúp (bạn nhận khi vào game); thưởng của mình nhận khi về nhà. */
export async function sendHelp(fromName: string, friendUid: string, friendName: string): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) return false
  try {
    await cloud.send(friendUid, 'help', fromName)
  } catch (e) {
    notifyError(e)
    return false
  }
  try {
    const n = Number(localStorage.getItem(PENDING_KEY) ?? 0)
    localStorage.setItem(PENDING_KEY, String(n + 1))
  } catch {
    // Không lưu được thưởng chờ thì thôi, việc tưới giúp vẫn đã gửi.
  }
  bus.emit('notify', { key: 'online.helpSent', params: { name: friendName, gold: HELP_GOLD }, good: true })
  return true
}

function claimHelpReward(state: GameState): void {
  let n = 0
  try {
    n = Number(localStorage.getItem(PENDING_KEY) ?? 0)
    localStorage.removeItem(PENDING_KEY)
  } catch {
    return
  }
  if (!(n > 0)) return
  state.player.gold += n * HELP_GOLD
  gainXp(state, n * HELP_XP)
  setTimeout(() => bus.emit('notify', { key: 'online.helpReward', params: { gold: n * HELP_GOLD }, good: true }), 2000)
}

export function notifyError(e: unknown): void {
  const code = e instanceof CloudError ? e.code : 'other'
  bus.emit('notify', { key: `online.error.${code}` })
}

/** Nông trại của bạn (bản mới nhất trên mây) để thăm; null nếu bạn chưa lưu lên mây. */
export async function loadFriendFarm(uid: string): Promise<GameState | null> {
  const cloud = await connect()
  const remote = await cloud.downloadSave(uid)
  if (!remote) return null
  return (await decodeSave(remote.data)).state
}
