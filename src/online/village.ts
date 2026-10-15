import { bus, type Progress } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { gainXp } from '../systems/progress.ts'
import { online } from './online.ts'

/**
 * Hội làng: cả nhóm chung một làng, mỗi tuần một mục tiêu (luân phiên theo số tuần).
 * Mỗi người tự động góp khi làm việc đó (gom lại, khoảng mỗi phút gửi một lần).
 * Đạt mục tiêu: ai đã góp được thưởng, và công trình chung của làng lên một cấp
 * (đài phun nước → cối xay gió → tượng gà vàng) hiện ở quảng trường mọi nông trại.
 * Firestore: village/w{tuần} (tiến độ, ai góp bao nhiêu), village/meta (cấp công trình).
 */

export interface VillageGoal {
  type: Progress['type']
  target: number
  icon: string
}

const GOALS: VillageGoal[] = [
  { type: 'deliver', target: 40, icon: '📦' },
  { type: 'harvest', target: 300, icon: '🌾' },
  { type: 'fish', target: 60, icon: '🎣' },
  { type: 'sellGold', target: 15000, icon: '💰' },
]
const WEEK_MS = 7 * 86_400_000
/** Tuần bắt đầu thứ Hai 0 giờ giờ Việt Nam (UTC+7); 1970-01-05 là thứ Hai. */
const WEEK_ORIGIN = Date.UTC(1970, 0, 5) - 7 * 3_600_000
const FLUSH_MS = 60_000
export const VILLAGE_REWARD = 500
const REWARD_XP = 30
export const MAX_MONUMENT = 3
const CLAIMED_KEY = 'noahfarm.villageClaimed'

export function weekId(now = Date.now()): number {
  return Math.floor((now - WEEK_ORIGIN) / WEEK_MS)
}

export function goalOf(week: number): VillageGoal {
  return GOALS[week % GOALS.length]
}

/** Mốc kết thúc tuần (ms). */
export function weekEnd(week: number): number {
  return WEEK_ORIGIN + (week + 1) * WEEK_MS
}

export const village = {
  week: weekId(),
  progress: 0,
  members: {} as Record<string, { name: string; n: number }>,
  /** Cấp công trình chung (0..MAX_MONUMENT). */
  level: 0,
  loaded: false,
}

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))
let pending = 0
let started = false

/** Nghe tiến độ tuần này và cấp công trình; gom phần đóng góp gửi định kỳ. */
export async function startVillage(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud || started) return
  started = true
  const fs = await lib()
  const db = fs.getFirestore(cloud.app)
  fs.onSnapshot(fs.doc(db, 'village', `w${village.week}`), (snap) => {
    const d = snap.data() ?? {}
    village.progress = (d.progress as number) ?? 0
    village.members = (d.members as typeof village.members) ?? {}
    village.loaded = true
    void checkDone(state)
    bus.emit('villageChanged', undefined)
  }, (e) => console.warn('Village', e))
  fs.onSnapshot(fs.doc(db, 'village', 'meta'), (snap) => {
    village.level = Math.min(MAX_MONUMENT, ((snap.data()?.level as number) ?? 0))
    bus.emit('villageChanged', undefined)
  }, (e) => console.warn('Village meta', e))
  window.setInterval(() => void flush(state), FLUSH_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush(state)
  })
  // Tuần trước đã xong mà chưa nhận thưởng (vd. không mở game lúc hoàn thành).
  void claimWeek(state, village.week - 1)
}

/** Đếm phần đóng góp khi làm đúng việc của tuần này. */
export function onVillageProgress(ev: Progress): void {
  if (ev.type !== goalOf(village.week).type) return
  pending += ev.amount
}

async function flush(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud || pending <= 0) return
  const n = pending
  pending = 0
  const fs = await lib()
  const me = cloud.account.uid
  try {
    // Tuần mới (đổi mục tiêu) thì phần đang gom thuộc tuần mới.
    const week = weekId()
    if (week !== village.week) {
      village.week = week
      started = false
      void startVillage(state)
    }
    await fs.setDoc(
      fs.doc(fs.getFirestore(cloud.app), 'village', `w${week}`),
      { progress: fs.increment(n), members: { [me]: { name: state.player.name, n: fs.increment(n) } } },
      { merge: true },
    )
  } catch (e) {
    pending += n
    console.warn('Village flush', e)
  }
}

/** Tuần đã đạt: nâng cấp công trình (một lần cho mỗi tuần) và nhận thưởng nếu mình có góp. */
async function checkDone(state: GameState): Promise<void> {
  const goal = goalOf(village.week)
  if (village.progress < goal.target) return
  const cloud = online.cloud
  if (!cloud) return
  const fs = await lib()
  const db = fs.getFirestore(cloud.app)
  try {
    await fs.runTransaction(db, async (tx) => {
      const ref = fs.doc(db, 'village', 'meta')
      const meta = (await tx.get(ref)).data() ?? { level: 0, weeks: [] }
      const weeks = (meta.weeks as number[]) ?? []
      if (weeks.includes(village.week)) return
      tx.set(ref, { level: Math.min(MAX_MONUMENT, ((meta.level as number) ?? 0) + 1), weeks: [...weeks, village.week].slice(-20) })
    })
  } catch (e) {
    console.warn('Village level', e)
  }
  await claimWeek(state, village.week)
}

async function claimWeek(state: GameState, week: number): Promise<void> {
  const cloud = online.cloud
  if (!cloud) return
  let claimed: number[] = []
  try {
    claimed = JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]') as number[]
  } catch {
    return
  }
  if (claimed.includes(week)) return
  let members = village.members
  let progress = village.progress
  if (week !== village.week) {
    const fs = await lib()
    const d = (await fs.getDoc(fs.doc(fs.getFirestore(cloud.app), 'village', `w${week}`)).catch(() => null))?.data()
    if (!d) return
    members = (d.members as typeof members) ?? {}
    progress = (d.progress as number) ?? 0
  }
  if (progress < goalOf(week).target || !(members[cloud.account.uid]?.n > 0)) return
  try {
    localStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimed, week].slice(-20)))
  } catch {
    return
  }
  state.player.gold += VILLAGE_REWARD
  gainXp(state, REWARD_XP)
  bus.emit('notify', { key: 'village.done', params: { gold: VILLAGE_REWARD }, good: true })
  bus.emit('saveRequest', undefined)
}
