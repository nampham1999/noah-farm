import { bus, type Progress } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { notifyError, online } from './online.ts'

/**
 * Thách đấu 5 phút giữa hai người bạn (Firestore contests/{id}): thi câu cá hoặc thu hoạch.
 * Người được thách đồng ý thì bắt đầu tính giờ; mỗi người tự cộng điểm của mình khi làm việc.
 * Hết giờ: thắng 300 vàng, hoà mỗi người 150, thua vẫn được 50 (mỗi người tự nhận trên máy mình).
 */

export type ContestKind = 'fish' | 'harvest'
export type ContestStatus = 'pending' | 'live' | 'over' | 'declined'

export interface Contest {
  id: string
  a: string
  aName: string
  b: string
  bName: string
  players: string[]
  kind: ContestKind
  status: ContestStatus
  startAt: number
  endAt: number
  scoreA: number
  scoreB: number
}

export const CONTEST_MS = 5 * 60_000
const PRIZE = { win: 300, tie: 150, lose: 50 }
const CLAIMED_KEY = 'noahfarm.contestsClaimed'

export const contests = {
  /** Lời thách gửi tới mình, chờ trả lời. */
  incoming: [] as Contest[],
  /** Trận đang diễn ra (của mình). */
  live: null as Contest | null,
}

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))
let stop: (() => void) | null = null

function claimed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** Nghe mọi trận có mình; tự kết thúc trận hết giờ và nhận thưởng. */
export async function watchContests(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud || stop) return
  const fs = await lib()
  const me = cloud.account.uid
  const db = fs.getFirestore(cloud.app)
  // Hai truy vấn (mình là người thách / người được thách): luật Firestore xác minh được a == mình, b == mình.
  const byId = new Map<string, Contest>()
  const onSnap = (side: 'a' | 'b') => (snap: import('firebase/firestore').QuerySnapshot) => {
    for (const [id, c] of byId) if (c[side] === me) byId.delete(id)
    for (const d of snap.docs) byId.set(d.id, { id: d.id, ...d.data() } as Contest)
    const all = [...byId.values()]
    contests.incoming = all.filter((c) => c.status === 'pending' && c.b === me)
    contests.live = all.find((c) => c.status === 'live' && Date.now() <= c.endAt) ?? null
    for (const c of all) if (c.status === 'over' || (c.status === 'live' && Date.now() > c.endAt)) void finish(state, c)
    bus.emit('contestChanged', undefined)
  }
  const stops = (['a', 'b'] as const).map((side) =>
    fs.onSnapshot(fs.query(fs.collection(db, 'contests'), fs.where(side, '==', me)), onSnap(side), (e) => console.warn('Contests', e)),
  )
  stop = () => stops.forEach((f) => f())
  // Hết giờ mà không có ai cộng điểm thì snapshot không tới: tự kiểm tra mỗi vài giây.
  window.setInterval(() => {
    const c = contests.live
    if (c && Date.now() > c.endAt) void finish(state, c)
    bus.emit('contestChanged', undefined)
  }, 1000)
}

export async function challenge(state: GameState, friend: { uid: string; name: string }, kind: ContestKind): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud) return false
  const fs = await lib()
  const me = cloud.account.uid
  try {
    await fs.addDoc(fs.collection(fs.getFirestore(cloud.app), 'contests'), {
      a: me, aName: state.player.name, b: friend.uid, bName: friend.name, players: [me, friend.uid],
      kind, status: 'pending', startAt: 0, endAt: 0, scoreA: 0, scoreB: 0,
    })
  } catch (e) {
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'contest.sent', params: { name: friend.name }, good: true })
  return true
}

export async function answer(c: Contest, accept: boolean): Promise<void> {
  const fs = await lib()
  const now = Date.now()
  try {
    await fs.updateDoc(fs.doc(fs.getFirestore(online.cloud!.app), 'contests', c.id), accept ? { status: 'live', startAt: now, endAt: now + CONTEST_MS } : { status: 'declined' })
  } catch (e) {
    notifyError(e)
  }
}

/** Cộng điểm khi làm đúng việc của trận đang diễn ra. */
export function onContestProgress(ev: Progress): void {
  const c = contests.live
  const me = online.cloud?.account.uid
  if (!c || !me || !fsLib || Date.now() > c.endAt) return
  if (!(c.kind === 'fish' ? ev.type === 'fish' : ev.type === 'harvest')) return
  const field = c.a === me ? 'scoreA' : 'scoreB'
  const fs = fsLib
  void fs.updateDoc(fs.doc(fs.getFirestore(online.cloud!.app), 'contests', c.id), { [field]: fs.increment(ev.amount) }).catch((e: unknown) => console.warn('Score', e))
}

async function finish(state: GameState, c: Contest): Promise<void> {
  const done = claimed()
  // Chỉ nhận thưởng trận vừa kết thúc (máy mới không nhận lại các trận cũ).
  if (done.includes(c.id) || Date.now() - c.endAt > 86_400_000) return
  try {
    localStorage.setItem(CLAIMED_KEY, JSON.stringify([...done, c.id].slice(-50)))
  } catch {
    return
  }
  const fs = await lib()
  if (c.status === 'live') {
    await fs.updateDoc(fs.doc(fs.getFirestore(online.cloud!.app), 'contests', c.id), { status: 'over' }).catch(() => {})
  }
  const me = online.cloud?.account.uid
  const mine = c.a === me ? c.scoreA : c.scoreB
  const theirs = c.a === me ? c.scoreB : c.scoreA
  const other = c.a === me ? c.bName : c.aName
  const result = mine > theirs ? 'win' : mine === theirs ? 'tie' : 'lose'
  state.player.gold += PRIZE[result]
  bus.emit('notify', { key: `contest.${result}`, params: { name: other, mine, theirs, gold: PRIZE[result] }, good: true })
  bus.emit('saveRequest', undefined)
  if (contests.live?.id === c.id) contests.live = null
  bus.emit('contestChanged', undefined)
}
