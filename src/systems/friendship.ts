import { bus, type Progress } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { item, ITEMS } from '../data/index.ts'
import { dayStamp } from './animals.ts'
import { addItem, canFit, removeItem } from './inventory.ts'

/**
 * Độ thân thiết với dân làng: giao đơn và tặng quà để tăng điểm (50 điểm một tim, tối đa 5).
 * Đạt 2, 3, 5 tim thì dân làng gửi thư kèm vàng và một món quà riêng.
 */

export const POINTS_PER_HEART = 50
export const MAX_HEARTS = 5
const DELIVER_POINTS = 20
const LIKED_GIFT = 25
const NORMAL_GIFT = 8

/** Món mỗi người thích: id vật phẩm, hoặc "kind:x" cho cả một loại. */
export const LIKES: Record<string, string[]> = {
  mia: ['crop_strawberry', 'egg', 'milk', 'honey', 'food_strawberry_cake'],
  tom: ['kind:fish', 'food_grilled_fish'],
  lan: ['kind:fruit', 'crop_strawberry', 'jar_strawberry'],
  bao: ['kind:food', 'crop_tomato', 'crop_pumpkin'],
  rosa: ['crop_watermelon', 'honey', 'fruit_cherry', 'fruit_apple'],
  kai: ['crop_corn', 'food_corn_bread', 'kind:jar'],
}

/** Quà trong thư ở mốc 2, 3 và 5 tim. */
const HEART_GIFTS: Record<string, [string, string, string]> = {
  mia: ['seed_strawberry', 'food_honey_cake', 'furn_oven'],
  tom: ['food_grilled_fish', 'sapling_orange', 'furn_aquarium'],
  lan: ['seed_strawberry', 'sapling_cherry', 'furn_piano'],
  bao: ['food_veggie_soup', 'food_pumpkin_soup', 'furn_fridge'],
  rosa: ['seed_watermelon', 'sapling_apple', 'furn_plant_big'],
  kai: ['seed_corn', 'food_corn_bread', 'furn_dining_set'],
}
const GIFT_HEARTS = [2, 3, 5]

export function friendOf(state: GameState, npc: string): { points: number; giftDay: number; rewarded: number } {
  state.friends[npc] ??= { points: 0, giftDay: -1, rewarded: 0 }
  return state.friends[npc]
}

export function hearts(state: GameState, npc: string): number {
  return Math.min(MAX_HEARTS, Math.floor((state.friends[npc]?.points ?? 0) / POINTS_PER_HEART))
}

export function likes(npc: string, itemId: string): boolean {
  const kind = item(itemId).kind
  return (LIKES[npc] ?? []).some((l) => l === itemId || l === `kind:${kind}`)
}

/** Biểu tượng các món người này thích (để gợi ý người chơi). */
export function likeIcons(npc: string): string[] {
  const icons: Record<string, string> = { fish: '🐟', fruit: '🍎', food: '🍲', jar: '🫙' }
  return (LIKES[npc] ?? []).map((l) => (l.startsWith('kind:') ? icons[l.slice(5)] : ITEMS.get(l)?.icon ?? '❓'))
}

export function giftedToday(state: GameState, npc: string): boolean {
  return state.friends[npc]?.giftDay === dayStamp(state.clock)
}

/** Vật phẩm trong túi tặng được (không phải dụng cụ, hạt giống, nội thất). */
export function giftable(state: GameState): string[] {
  const ids = state.inventory.slots.flatMap((s) => (s ? [s.id] : []))
  return [...new Set(ids)].filter((id) => !['tool', 'seed', 'furniture', 'sapling', 'feed'].includes(item(id).kind))
}

export function giveGift(state: GameState, npc: string, itemId: string): boolean {
  if (giftedToday(state, npc)) {
    bus.emit('notify', { key: 'friend.alreadyGifted', params: { name: `npc.${npc}` } })
    return false
  }
  if (!removeItem(state.inventory, itemId, 1)) return false
  const f = friendOf(state, npc)
  f.giftDay = dayStamp(state.clock)
  const liked = likes(npc, itemId)
  addPoints(state, npc, liked ? LIKED_GIFT : NORMAL_GIFT)
  bus.emit('notify', { key: liked ? 'friend.loved' : 'friend.thanks', params: { name: `npc.${npc}`, item: itemId }, good: true })
  bus.emit('sfx', liked ? 'quest' : 'click')
  bus.emit('saveRequest', undefined)
  return true
}

/** Giao đơn hàng cũng làm thân hơn. */
export function onFriendProgress(state: GameState, ev: Progress): void {
  if (ev.type === 'deliver' && ev.id && LIKES[ev.id]) addPoints(state, ev.id, DELIVER_POINTS)
}

function addPoints(state: GameState, npc: string, n: number): void {
  const f = friendOf(state, npc)
  const before = hearts(state, npc)
  f.points = Math.min(MAX_HEARTS * POINTS_PER_HEART, f.points + n)
  const now = hearts(state, npc)
  if (now > before) bus.emit('notify', { key: 'friend.heartUp', params: { name: `npc.${npc}`, n: now }, good: true })
  // Thư cảm ơn ở các mốc tim chưa nhận.
  GIFT_HEARTS.forEach((h, i) => {
    if (now >= h && f.rewarded < h) {
      f.rewarded = h
      sendLetter(state, npc, h, HEART_GIFTS[npc][i])
    }
  })
}

function sendLetter(state: GameState, npc: string, heart: number, giftId: string): void {
  const gold = heart * 100
  state.player.gold += gold
  const qty = giftId.startsWith('seed_') ? 5 : giftId.startsWith('food_') ? 2 : 1
  if (canFit(state.inventory, giftId, qty)) addItem(state.inventory, giftId, qty)
  bus.emit('notify', { key: 'friend.letter', params: { name: `npc.${npc}`, gold, item: giftId, qty }, good: true })
}
