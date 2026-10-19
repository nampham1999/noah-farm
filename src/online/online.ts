import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import type { AutoSaver } from '../save/autosave.ts'
import { gunzipBase64Url, gzipBase64Url } from '../save/codec.ts'
import { parseSave, serialize, type ParsedSave } from '../save/format.ts'
import type { SaveStore } from '../save/SaveStore.ts'
import { needsWater } from '../systems/farming.ts'
import { addItem, canFit, countItem, removeItem } from '../systems/inventory.ts'
import { balance, item, ITEMS } from '../data/index.ts'
import { itemName } from '../i18n/index.ts'
import { gainXp } from '../systems/progress.ts'
import { Cloud, CloudError, SWITCHED_KEY, type CloudErrorCode, type HelpRequest, type Profile } from './cloud.ts'

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
/** Người chơi đã xoá dữ liệu online: không tự kết nối và đồng bộ nữa cho tới khi bật lại. */
export const OFFLINE_KEY = 'noahfarm.onlineOff'

export function onlineDisabled(): boolean {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1'
  } catch {
    return false
  }
}

export function setOnlineDisabled(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFFLINE_KEY, '1')
    else localStorage.removeItem(OFFLINE_KEY)
  } catch {
    // Không lưu được thì thôi.
  }
}
const GUESTBOOK_MAX = 20
/** Câu chúc có sẵn cho sổ khách (khoá i18n guest.pN). */
export const GUEST_LINES = 8
/** Thưởng cho người gửi đồ giúp: giá bán của món + chừng này vàng mỗi món, và XP. */
const GIVE_BONUS = 10
const GIVE_XP = 4
/** Hái trộm: nhà có chó thì khả năng bị đuổi, và tiền phạt (về tay chủ nhà). */
const STEAL_DOG_CHANCE = 0.5
const STEAL_FINE = 30
/** Bắt sâu giúp bạn: thưởng cho người bắt. */
const PEST_GOLD = 30
const PEST_XP = 5

export const online = {
  status: 'off' as OnlineStatus,
  error: null as CloudErrorCode | null,
  cloud: null as Cloud | null,
  friends: [] as Profile[],
  /** Lần gửi bản lưu lên mây gần nhất (0 là chưa). */
  uploadedAt: 0,
  /** Lời nhờ giúp đang mở của bạn bè và của mình. */
  requests: [] as HelpRequest[],
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
  if (onlineDisabled()) {
    setStatus('off')
    return
  }
  let cloud: Cloud
  try {
    cloud = await connect()
  } catch {
    return
  }

  // Lấy bản lưu trên mây trước (đừng để lỗi đồng bộ hồ sơ chặn việc nạp dữ liệu tài khoản).
  const switched = localStorage.getItem(SWITCHED_KEY) !== null
  try {
    const remote = await cloud.downloadSave()
    // Vừa đăng nhập vào tài khoản Google đã có: dùng luôn bản lưu của tài khoản đó (không hỏi), giữ bản cũ trên máy để khôi phục.
    if (switched) {
      if (remote) {
        localStorage.removeItem(SWITCHED_KEY)
        try {
          localStorage.setItem('noahfarm.preSwitchSave', store.exportText(state, Date.now()))
        } catch {
          /* hết chỗ lưu: bỏ qua bản dự phòng */
        }
        autosaver.suspend()
        await store.replace(await gunzipBase64Url(remote.data))
        location.reload()
        return
      }
      // Tài khoản chưa lưu gì lên mây: giữ dữ liệu trên máy và lưu lên tài khoản này.
      localStorage.removeItem(SWITCHED_KEY)
    }
    // Bản trên mây mới hơn (chơi ở máy khác): hỏi có dùng không.
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
    // Lỗi mạng khi vừa đổi tài khoản: giữ cờ để lần mở sau thử tải lại, và báo người chơi.
    console.warn('Online sync failed', e)
    if (switched) notifyError(e)
  }
  try {
    await syncProfile(state)
  } catch (e) {
    console.warn('Profile sync failed', e)
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
  const code = await cloud.saveProfile({
    name: state.player.name, level: state.player.level, look: state.player.look, code: state.meta.inviteCode,
    harvest: state.stats.harvest, fish: state.stats.fish, goldEarned: state.stats.goldEarned,
  }, randomCode)
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
    } else if (it.kind === 'give' && it.item && it.qty) {
      if (canFit(state.inventory, it.item, it.qty)) addItem(state.inventory, it.item, it.qty)
      bus.emit('notify', { key: 'request.received', params: { name: it.fromName, item: it.item, qty: it.qty }, good: true })
    } else if (it.kind === 'note' && it.text) {
      state.guestbook.unshift({ from: it.fromName, text: it.text, at: Date.now() })
      state.guestbook.length = Math.min(state.guestbook.length, GUESTBOOK_MAX)
      bus.emit('notify', { key: 'guest.got', params: { name: it.fromName, text: it.text }, good: true })
    } else if (it.kind === 'steal') {
      if (it.text === 'caught') {
        state.player.gold += STEAL_FINE
        bus.emit('notify', { key: 'steal.dogChased', params: { name: it.fromName, gold: STEAL_FINE }, good: true })
      } else {
        // Cây đó còn chín thì mất thật; không còn (đã thu hoạch) thì chỉ báo.
        const plot = state.plots.find((p) => `${p.x},${p.z}` === it.text)
        if (plot?.crop && plot.stage >= balance.cropStages && `crop_${plot.crop}` === it.item) {
          plot.crop = null
          plot.stage = 0
          plot.wateredAt = null
        }
        bus.emit('notify', { key: 'steal.stolen', params: { name: it.fromName, item: it.item ?? '' } })
      }
    } else if (it.kind === 'pest' && it.text) {
      const i = state.pests.indexOf(it.text)
      if (i >= 0) state.pests.splice(i, 1)
      bus.emit('notify', { key: 'pest.friendHelped', params: { name: it.fromName }, good: true })
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
    await cloud.send(friend.uid, 'gift', state.player.name, { item: itemId, qty: 1 })
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
  addPending({ gold: HELP_GOLD, xp: HELP_XP })
  bus.emit('notify', { key: 'online.helpSent', params: { name: friendName, gold: HELP_GOLD }, good: true })
  return true
}

/**
 * Phần thưởng chờ nhận: kiếm được lúc đang thăm nông trại bạn (trạng thái đang mở là của bạn),
 * cộng vào nông trại của mình lần sau về nhà. Vàng có thể âm (tiền phạt bị chó đuổi).
 */
interface Pending {
  gold: number
  xp: number
  items: Record<string, number>
}
const PENDING_ALL_KEY = 'noahfarm.pending'

export function addPending(add: { gold?: number; xp?: number; item?: string; qty?: number }): void {
  try {
    const p: Pending = JSON.parse(localStorage.getItem(PENDING_ALL_KEY) ?? '{"gold":0,"xp":0,"items":{}}')
    p.gold += add.gold ?? 0
    p.xp += add.xp ?? 0
    if (add.item) p.items[add.item] = (p.items[add.item] ?? 0) + (add.qty ?? 1)
    localStorage.setItem(PENDING_ALL_KEY, JSON.stringify(p))
  } catch {
    // Không lưu được thì thôi.
  }
}

function claimHelpReward(state: GameState): void {
  let p: Pending = { gold: 0, xp: 0, items: {} }
  try {
    // Bản cũ chỉ đếm số lượt tưới giúp.
    const old = Number(localStorage.getItem(PENDING_KEY) ?? 0)
    if (old > 0) {
      p.gold += old * HELP_GOLD
      p.xp += old * HELP_XP
    }
    localStorage.removeItem(PENDING_KEY)
    const raw = localStorage.getItem(PENDING_ALL_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Pending
      p = { gold: p.gold + saved.gold, xp: p.xp + saved.xp, items: saved.items ?? {} }
    }
    localStorage.removeItem(PENDING_ALL_KEY)
  } catch {
    return
  }
  const items = Object.entries(p.items).filter(([id, n]) => n > 0 && ITEMS.has(id))
  if (!p.gold && !p.xp && !items.length) return
  state.player.gold = Math.max(0, state.player.gold + p.gold)
  if (p.xp > 0) gainXp(state, p.xp)
  for (const [id, n] of items) if (canFit(state.inventory, id, n)) addItem(state.inventory, id, n)
  const what = items.map(([id, n]) => `${n} ${itemName(id)}`).join(', ')
  setTimeout(() => bus.emit('notify', { key: 'online.visitReward', params: { gold: p.gold, items: what || '—' }, good: true }), 2000)
  bus.emit('saveRequest', undefined)
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

/** Đang thăm nông trại bạn: ghi sổ khách (một câu có sẵn, mỗi ngày một lần). */
export async function sendNote(fromName: string, friendUid: string, friendName: string, text: string): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) return false
  try {
    await cloud.send(friendUid, 'note', fromName, { text })
  } catch (e) {
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'guest.sent', params: { name: friendName }, good: true })
  return true
}

/** Nhờ bạn bè: thiếu qty món item (cho đơn hàng). */
export async function postRequest(state: GameState, item: string, qty: number): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) {
    bus.emit('notify', { key: 'online.error.offline' })
    return false
  }
  try {
    await cloud.postRequest({ name: state.player.name, item, qty })
  } catch (e) {
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'request.posted', params: { item, qty }, good: true })
  return true
}

/** Gửi đồ trong túi cho lời nhờ của bạn; được thưởng vàng (giá món + thêm) và XP. */
export async function giveToRequest(state: GameState, req: HelpRequest): Promise<boolean> {
  const cloud = online.cloud
  const n = Math.min(req.qty - req.have, countItem(state.inventory, req.item))
  if (!cloud || n <= 0) return false
  try {
    await cloud.fulfill(req, n, state.player.name)
  } catch (e) {
    notifyError(e)
    return false
  }
  removeItem(state.inventory, req.item, n)
  const gold = ((item(req.item).sellPrice ?? 0) + GIVE_BONUS) * n
  state.player.gold += gold
  gainXp(state, GIVE_XP * n)
  req.have += n
  bus.emit('notify', { key: 'request.gave', params: { name: req.name, item: req.item, qty: n, gold }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/** Tải lại các lời nhờ đang mở (của bạn bè và của mình); lời nhờ đã đủ thì của mình được dọn. */
export async function refreshRequests(): Promise<HelpRequest[]> {
  const cloud = online.cloud
  if (!cloud) return []
  try {
    const me = cloud.account.uid
    const list = await cloud.requests([me, ...online.friends.map((f) => f.uid)])
    const mine = list.find((r) => r.uid === me)
    if (mine && mine.have >= mine.qty) await cloud.cancelRequest()
    online.requests = list.filter((r) => r.have < r.qty)
    bus.emit('onlineChanged', undefined)
  } catch (e) {
    console.warn('Requests failed', e)
  }
  return online.requests
}

export async function cancelRequest(): Promise<void> {
  try {
    await online.cloud?.cancelRequest()
    await refreshRequests()
  } catch (e) {
    notifyError(e)
  }
}

/** Thăm bạn: hái trộm một cây chín (mỗi bạn mỗi ngày một lần). Nhà có chó thì có thể bị đuổi, mất tiền phạt. */
export async function stealCrop(visited: GameState, friendUid: string, plotKey: string, cropItem: string): Promise<'stolen' | 'caught' | 'failed'> {
  const cloud = online.cloud
  if (!cloud) return 'failed'
  const caught = visited.pet !== null && Math.random() < STEAL_DOG_CHANCE
  try {
    await cloud.send(friendUid, 'steal', myVisitName(), caught ? { text: 'caught' } : { item: cropItem, text: plotKey })
  } catch (e) {
    notifyError(e)
    return 'failed'
  }
  if (caught) {
    addPending({ gold: -STEAL_FINE })
    bus.emit('sfx', 'dog')
    bus.emit('notify', { key: 'steal.caught', params: { gold: STEAL_FINE } })
    return 'caught'
  }
  addPending({ item: cropItem, qty: 1 })
  bus.emit('notify', { key: 'steal.done', params: { item: cropItem }, good: true })
  return 'stolen'
}

/** Thăm bạn: bắt sâu giúp (mỗi bạn mỗi ngày một lần); mình được thưởng khi về nhà. */
export async function helpPest(friendUid: string, plotKey: string): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) return false
  try {
    await cloud.send(friendUid, 'pest', myVisitName(), { text: plotKey })
  } catch (e) {
    notifyError(e)
    return false
  }
  addPending({ gold: PEST_GOLD, xp: PEST_XP })
  bus.emit('notify', { key: 'pest.helped', params: { gold: PEST_GOLD }, good: true })
  return true
}

/** Tên của mình khi đang thăm (đọc từ bản lưu trên máy). */
let visitName = 'Noah'
export function setVisitName(name: string): void {
  visitName = name
}
function myVisitName(): string {
  return visitName
}

