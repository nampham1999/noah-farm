import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { pairId, type ChatMessage } from './cloud.ts'
import { notifyError, online } from './online.ts'

/**
 * Chat như bản cũ: kênh Làng chung cho mọi người, và chat riêng với bạn bè.
 * - Từ cấp 2 mới được nói (vẫn đọc được), tối đa 200 ký tự, 5 giây một tin.
 * - Tin hệ thống (người mới, lên cấp, nâng nhà) lưu dạng khoá i18n để ai đọc cũng đúng ngôn ngữ.
 * - Chặn người: ẩn tin của họ (lưu trên máy).
 */

export const CHAT_LEVEL = 2
export const MAX_CHARS = 200
const COOLDOWN_MS = 5000
const BLOCK_KEY = 'noahfarm.blocked'
const READ_KEY = 'noahfarm.dmRead'
const JOINED_KEY = 'noahfarm.joinedVillage'

export const chat = {
  world: [] as ChatMessage[],
  /** Số tin chưa đọc theo bạn (uid). */
  unread: new Map<string, number>(),
  /** Tin cuối của từng cuộc trò chuyện riêng. */
  heads: new Map<string, { lastAt: number; lastFrom: string; lastText: string }>(),
  blocked: new Set<string>(load<string[]>(BLOCK_KEY, [])),
  lastPost: 0,
}

let stopWorld: (() => void) | null = null
let stopHeads: (() => void) | null = null
let watchedFriends = ''

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Không lưu được thì thôi; chat vẫn chạy.
  }
}

function changed(): void {
  bus.emit('chatChanged', undefined)
}

/** Tổng số tin riêng chưa đọc (để hiện chấm đỏ trên nút 💬). */
export function unreadTotal(): number {
  let n = 0
  for (const v of chat.unread.values()) n += v
  return n
}

/** Bắt đầu nghe kênh Làng và tin riêng của bạn bè (gọi lại khi danh sách bạn đổi). */
export function startChat(state: GameState): void {
  const cloud = online.cloud
  if (!cloud) return
  stopWorld ??= cloud.watchWorld((list) => {
    chat.world = list
    changed()
  })
  const ids = online.friends.map((f) => f.uid).sort().join(',')
  if (ids !== watchedFriends) {
    watchedFriends = ids
    stopHeads?.()
    stopHeads = cloud.watchDmHeads(online.friends.map((f) => f.uid), (heads) => {
      chat.heads = heads
      recount()
    })
  }
  // Lần đầu vào làng: chào mọi người.
  if (!load<boolean>(JOINED_KEY, false)) {
    store(JOINED_KEY, true)
    void announce(state, 'chat.event.joined', {})
  }
}

function recount(): void {
  const me = online.cloud?.account.uid
  const read = load<Record<string, number>>(READ_KEY, {})
  chat.unread.clear()
  for (const [friend, head] of chat.heads) {
    if (head.lastFrom !== me && head.lastAt > (read[friend] ?? 0)) chat.unread.set(friend, 1)
  }
  changed()
}

/** Đã xem cuộc trò chuyện với bạn này. */
export function markRead(friendUid: string): void {
  const read = load<Record<string, number>>(READ_KEY, {})
  read[friendUid] = Date.now()
  store(READ_KEY, read)
  recount()
}

/** Kiểm tra trước khi gửi; trả về khoá thông báo lỗi, hoặc null nếu gửi được. */
export function canPost(state: GameState, text: string): string | null {
  if (state.player.level < CHAT_LEVEL) return 'chat.needLevel'
  if (!text.trim()) return 'chat.empty'
  if (Date.now() - chat.lastPost < COOLDOWN_MS) return 'chat.slowDown'
  return null
}

export async function postWorld(state: GameState, text: string): Promise<boolean> {
  const err = canPost(state, text)
  if (err) {
    bus.emit('notify', { key: err, params: { level: CHAT_LEVEL, n: Math.ceil((COOLDOWN_MS - (Date.now() - chat.lastPost)) / 1000) } })
    return false
  }
  chat.lastPost = Date.now()
  try {
    await online.cloud!.postWorld(state.player.name, clean(text))
    return true
  } catch (e) {
    notifyError(e)
    return false
  }
}

export async function sendDm(state: GameState, friendUid: string, text: string): Promise<boolean> {
  const err = canPost(state, text)
  if (err) {
    bus.emit('notify', { key: err, params: { level: CHAT_LEVEL, n: Math.ceil((COOLDOWN_MS - (Date.now() - chat.lastPost)) / 1000) } })
    return false
  }
  chat.lastPost = Date.now()
  try {
    await online.cloud!.sendDm(friendUid, state.player.name, clean(text))
    markRead(friendUid)
    return true
  } catch (e) {
    notifyError(e)
    return false
  }
}

export function watchDm(friendUid: string, onChange: (list: ChatMessage[]) => void): () => void {
  return online.cloud!.watchDm(friendUid, onChange)
}

/** Tin hệ thống trên kênh Làng: lưu khoá i18n và tham số (JSON) để người đọc tự dịch. */
export async function announce(state: GameState, key: string, params: Record<string, string | number>): Promise<void> {
  if (!online.cloud) return
  try {
    await online.cloud.postWorld(state.player.name, `${key}|${JSON.stringify({ name: state.player.name, ...params })}`, 'event')
  } catch (e) {
    console.warn('Announce failed', e)
  }
}

/** Tách tin hệ thống thành khoá và tham số. */
export function parseEvent(text: string): { key: string; params: Record<string, string | number> } {
  const i = text.indexOf('|')
  try {
    return { key: text.slice(0, i), params: JSON.parse(text.slice(i + 1)) }
  } catch {
    return { key: text, params: {} }
  }
}

export function toggleBlock(uid: string): boolean {
  if (chat.blocked.has(uid)) chat.blocked.delete(uid)
  else chat.blocked.add(uid)
  store(BLOCK_KEY, [...chat.blocked])
  changed()
  return chat.blocked.has(uid)
}

export function myUid(): string | null {
  return online.cloud?.account.uid ?? null
}

export { pairId }

/** Lọc vài từ thô tục phổ biến (tiếng Việt và tiếng Anh) thành ***. */
const BAD = ['địt', 'đụ', 'lồn', 'buồi', 'cặc', 'đéo', 'vcl', 'vkl', 'dcm', 'đcm', 'đm', 'clm', 'fuck', 'shit', 'bitch', 'cunt', 'dick']
const BAD_RE = new RegExp(`(^|[^\\p{L}])(${BAD.join('|')})(?=$|[^\\p{L}])`, 'giu')
export function clean(text: string): string {
  return text.slice(0, MAX_CHARS).replace(BAD_RE, (_, pre: string, word: string) => pre + '*'.repeat(word.length))
}
