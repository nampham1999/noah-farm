import { bus } from '../core/events.ts'
import type { Look } from '../core/look.ts'
import { FIREBASE_CONFIG } from './cloud.ts'
import { online } from './online.ts'

/**
 * Gặp nhau trực tiếp: mỗi nông trại là một "phòng" trên Firebase Realtime Database
 * (rooms/{chủ nông trại}/{người chơi}). Ai đang ở nông trại đó (chủ hoặc khách) gửi vị trí
 * vài lần mỗi giây khi di chuyển, và biểu cảm; mất kết nối thì tự rời phòng.
 * Realtime Database không tính phí theo lần ghi nên hợp để gửi vị trí liên tục.
 */

export interface RemotePlayer {
  uid: string
  name: string
  look: Look | null
  x: number
  z: number
  /** Hướng quay, tốc độ 0..1, đang trong nhà. */
  r: number
  s: number
  in: boolean
  /** Biểu cảm / câu nói nhanh gần nhất và lúc gửi (ms). */
  e?: string
  et?: number
}

export const presence = {
  /** Phòng đang ở (uid chủ nông trại), null nếu chưa vào. */
  room: null as string | null,
  players: new Map<string, RemotePlayer>(),
}

/** Gửi vị trí dày nhất mỗi chừng này ms, và ít nhất mỗi chừng này ms dù đứng yên (để biết còn ở đó). */
const SEND_MS = 200
const HEARTBEAT_MS = 5000

type Db = typeof import('firebase/database')
let lib: Db | null = null
let myRef: import('firebase/database').DatabaseReference | null = null
let stops: (() => void)[] = []
let last = { x: 0, z: 0, r: 0, in: false, at: 0, sent: 0 }

export function presenceAvailable(): boolean {
  return FIREBASE_CONFIG.databaseURL !== '' && online.cloud !== null
}

/** Vào phòng của nông trại farmUid với tên và ngoại hình của mình. */
export async function joinRoom(farmUid: string, me: { name: string; look: Look | null }): Promise<void> {
  if (!presenceAvailable() || presence.room === farmUid) return
  await leaveRoom()
  try {
    lib ??= await import('firebase/database')
    const { getDatabase, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, ref, set } = lib
    const db = getDatabase(online.cloud!.app)
    const uid = online.cloud!.account.uid
    presence.room = farmUid
    myRef = ref(db, `rooms/${farmUid}/${uid}`)
    await onDisconnect(myRef).remove()
    await set(myRef, { name: me.name, look: me.look ?? null, x: 0, z: 0, r: 0, s: 0, in: false, at: Date.now() })
    const roomRef = ref(db, `rooms/${farmUid}`)
    const upsert = (snap: import('firebase/database').DataSnapshot) => {
      if (!snap.key || snap.key === uid) return
      const data = snap.val() as Omit<RemotePlayer, 'uid'>
      const prev = presence.players.get(snap.key)
      presence.players.set(snap.key, { uid: snap.key, ...data })
      if (!prev) bus.emit('notify', { key: 'presence.joined', params: { name: data.name } })
      else if (data.e && data.et !== prev.et) bus.emit('presenceEmote', snap.key)
      bus.emit('presenceChanged', undefined)
    }
    stops = [
      onChildAdded(roomRef, upsert),
      onChildChanged(roomRef, upsert),
      onChildRemoved(roomRef, (snap) => {
        const p = snap.key ? presence.players.get(snap.key) : undefined
        if (!p) return
        presence.players.delete(p.uid)
        bus.emit('notify', { key: 'presence.left', params: { name: p.name } })
        bus.emit('presenceChanged', undefined)
      }),
    ]
  } catch (e) {
    console.warn('Presence join failed', e)
    presence.room = null
  }
}

export async function leaveRoom(): Promise<void> {
  stops.forEach((stop) => stop())
  stops = []
  presence.players.clear()
  if (myRef && lib) await lib.remove(myRef).catch(() => {})
  myRef = null
  presence.room = null
  bus.emit('presenceChanged', undefined)
}

/** Mỗi khung hình: gửi vị trí nếu đã đổi (tối đa 5 lần/giây), hoặc nhịp tim mỗi 5 giây. */
export function sendPose(x: number, z: number, r: number, s: number, indoors: boolean): void {
  if (!myRef || !lib) return
  const now = performance.now()
  if (now - last.sent < SEND_MS) return
  const moved = Math.hypot(x - last.x, z - last.z) > 0.05 || Math.abs(r - last.r) > 0.1 || indoors !== last.in
  if (!moved && now - last.sent < HEARTBEAT_MS) return
  last = { x, z, r, in: indoors, at: now, sent: now }
  void lib.update(myRef, { x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), s: +s.toFixed(2), in: indoors, at: Date.now() }).catch(() => {})
}

/** Gửi biểu cảm / câu nói nhanh (hiện thành bong bóng trên đầu ở mọi máy trong phòng). */
export function sendEmote(e: string): void {
  if (!myRef || !lib) return
  void lib.update(myRef, { e, et: Date.now() }).catch(() => {})
}
