import { bus, type Progress } from '../core/events.ts'
import type { DailyQuest, GameState } from '../core/state.ts'
import { mulberry32 } from '../core/random.ts'
import { CROPS, FISH } from '../data/index.ts'
import questsJson from '../data/quests.json'
import { dayStamp } from './animals.ts'
import { gainXp } from './progress.ts'

/**
 * Nhiệm vụ (GDD mục 3.7): chuỗi hướng dẫn qua từng hệ thống, sau đó là nhiệm vụ
 * hằng ngày với thưởng nhỏ; kèm thành tựu tính từ số liệu cộng dồn.
 */

export interface TutorialQuest {
  id: string
  type: Progress['type']
  target: number
  gold: number
  xp: number
  icon: string
}

export interface DailyTemplate {
  id: string
  type: Progress['type']
  min: number
  max: number
  goldPer: number
  icon: string
  needsAnimals?: boolean
}

export interface Achievement {
  id: string
  stat: 'harvest' | 'fish' | 'fishSpecies' | 'cropSpecies' | 'goldEarned' | 'animals' | 'land' | 'furniture' | 'level'
  target: number
  icon: string
}

export const questData = questsJson as {
  tutorial: TutorialQuest[]
  daily: DailyTemplate[]
  dailyCount: number
  dailyXp: number
  dailyBonusXp: number
  achievements: Achievement[]
}
const TEMPLATE_BY_ID = new Map(questData.daily.map((d) => [d.id, d]))

export function currentTutorial(state: GameState): TutorialQuest | null {
  return questData.tutorial[state.quests.step] ?? null
}

export function dailyTemplate(q: DailyQuest): DailyTemplate {
  return TEMPLATE_BY_ID.get(q.id)!
}

export function dailyReward(q: DailyQuest): number {
  return Math.round(q.target * dailyTemplate(q).goldPer)
}

/** Tạo nhiệm vụ hằng ngày nếu hôm nay chưa có (gọi khi mở game và khi sang ngày mới). */
export function ensureDaily(state: GameState): void {
  const today = dayStamp(state.clock)
  if (state.quests.daily.day === today) return
  const rand = mulberry32(today * 7919)
  const pool = questData.daily.filter((d) => !d.needsAnimals || state.animals.length > 0)
  const list: DailyQuest[] = []
  while (list.length < Math.min(questData.dailyCount, pool.length)) {
    const d = pool[Math.floor(rand() * pool.length)]
    if (list.some((q) => q.id === d.id)) continue
    const raw = d.min + rand() * (d.max - d.min)
    // Số vàng làm tròn 10, số việc làm tròn 1.
    const target = d.type === 'sellGold' ? Math.round(raw / 10) * 10 : Math.round(raw)
    list.push({ id: d.id, target, progress: 0 })
  }
  state.quests.daily = { day: today, list, bonusClaimed: false }
}

/** Ghi nhận một việc vừa làm: sổ cây, số liệu, nhiệm vụ hướng dẫn, nhiệm vụ hằng ngày, thành tựu. */
export function onProgress(state: GameState, ev: Progress): void {
  if (ev.type === 'harvest') {
    state.stats.harvest += ev.amount
    if (ev.id) state.journal.crops[ev.id] = (state.journal.crops[ev.id] ?? 0) + ev.amount
  }
  if (ev.type === 'fish') state.stats.fish += ev.amount
  if (ev.type === 'sellGold') state.stats.goldEarned += ev.amount

  const tut = currentTutorial(state)
  if (tut && tut.type === ev.type) {
    state.quests.progress += ev.amount
    if (state.quests.progress >= tut.target) {
      state.player.gold += tut.gold
      gainXp(state, tut.xp)
      state.quests.step++
      state.quests.progress = 0
      bus.emit('notify', { key: 'quest.done', params: { name: `quest.${tut.id}`, n: tut.target, gold: tut.gold }, good: true })
      const next = currentTutorial(state)
      if (next) bus.emit('notify', { key: 'quest.next', params: { name: `quest.${next.id}`, n: next.target } })
      else bus.emit('notify', { key: 'quest.tutorialDone', good: true })
    }
  }

  ensureDaily(state)
  const daily = state.quests.daily
  for (const q of daily.list) {
    if (q.progress >= q.target || dailyTemplate(q).type !== ev.type) continue
    q.progress = Math.min(q.target, q.progress + ev.amount)
    if (q.progress >= q.target) {
      const gold = dailyReward(q)
      state.player.gold += gold
      gainXp(state, questData.dailyXp)
      bus.emit('notify', { key: 'quest.dailyDone', params: { name: `quest.${q.id}`, n: q.target, gold }, good: true })
    }
  }
  if (!daily.bonusClaimed && daily.list.length > 0 && daily.list.every((q) => q.progress >= q.target)) {
    daily.bonusClaimed = true
    gainXp(state, questData.dailyBonusXp)
    bus.emit('notify', { key: 'quest.allDaily', params: { xp: questData.dailyBonusXp }, good: true })
  }

  checkAchievements(state)
  bus.emit('saveRequest', undefined)
}

export function statValue(state: GameState, stat: Achievement['stat']): number {
  switch (stat) {
    case 'harvest':
      return state.stats.harvest
    case 'fish':
      return state.stats.fish
    case 'fishSpecies':
      return FISH.filter((f) => state.journal.fish[f.id]).length
    case 'cropSpecies':
      return CROPS.filter((c) => state.journal.crops[c.id]).length
    case 'goldEarned':
      return state.stats.goldEarned
    case 'animals':
      return state.animals.length
    case 'land':
      return state.landLevel
    case 'furniture':
      return state.house.furniture.length
    case 'level':
      return state.player.level
  }
}

/** Báo thành tựu mới đạt (mỗi cái một lần). */
export function checkAchievements(state: GameState): void {
  for (const a of questData.achievements) {
    if (state.journal.achievements.includes(a.id) || statValue(state, a.stat) < a.target) continue
    state.journal.achievements.push(a.id)
    bus.emit('notify', { key: 'achievement.unlocked', params: { name: `achievement.${a.id}` }, good: true })
  }
}
