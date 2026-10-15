import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { addItem, canFit, countItem, removeItem } from '../systems/inventory.ts'
import { addPending, notifyError, online } from './online.ts'

/**
 * Chợ phiên: mỗi người một sạp 6 ô (Firestore stalls/{uid}/listings/{0..5}).
 * - Chủ sạp bày món với giá tự đặt; món bày được rút khỏi túi (bán xong mới mất hẳn).
 * - Bạn bè mua lúc nào cũng được, kể cả khi chủ sạp không online: đánh dấu đã bán (luật chỉ cho
 *   chuyển còn → đã bán, nên hai người không mua trùng), trả vàng và nhận món ngay.
 * - Chủ sạp thu tiền những món đã bán mỗi khi vào game hoặc mở sạp; chưa bán thì huỷ được.
 */

export const STALL_SLOTS = 6

export interface Listing {
  slot: number
  item: string
  qty: number
  price: number
  sold: boolean
  buyerName?: string
}

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))

async function col(owner: string) {
  const fs = await lib()
  return { fs, ref: fs.collection(fs.getFirestore(online.cloud!.app), 'stalls', owner, 'listings') }
}

/** Các ô hàng của một sạp (chủ sạp là owner). */
export async function listings(owner: string): Promise<Listing[]> {
  if (!online.cloud) return []
  const { fs, ref } = await col(owner)
  try {
    const snap = await fs.getDocs(ref)
    return snap.docs.map((d) => ({ slot: Number(d.id), ...d.data() }) as Listing).sort((a, b) => a.slot - b.slot)
  } catch (e) {
    console.warn('Stall', e)
    return []
  }
}

/** Bày một món lên ô trống của sạp mình. */
export async function listItem(state: GameState, slot: number, item: string, qty: number, price: number): Promise<boolean> {
  if (!online.cloud || countItem(state.inventory, item) < qty || qty <= 0 || price <= 0) return false
  const { fs, ref } = await col(online.cloud.account.uid)
  removeItem(state.inventory, item, qty)
  try {
    await fs.setDoc(fs.doc(ref, String(slot)), { item, qty, price: Math.round(price), sold: false, at: Date.now() })
  } catch (e) {
    addItem(state.inventory, item, qty)
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'market.listed', params: { item, qty, price }, good: true })
  bus.emit('saveRequest', undefined)
  return true
}

/** Chủ sạp cất món chưa bán về túi. */
export async function unlist(state: GameState, l: Listing): Promise<void> {
  if (!online.cloud || l.sold) return
  const { fs, ref } = await col(online.cloud.account.uid)
  try {
    await fs.deleteDoc(fs.doc(ref, String(l.slot)))
    addItem(state.inventory, l.item, l.qty)
    bus.emit('saveRequest', undefined)
  } catch (e) {
    notifyError(e)
  }
}

/** Thu tiền những món đã bán ở sạp mình; trả về số vàng thu được. */
export async function collectSales(state: GameState): Promise<number> {
  if (!online.cloud) return 0
  const { fs, ref } = await col(online.cloud.account.uid)
  let total = 0
  try {
    const snap = await fs.getDocs(fs.query(ref, fs.where('sold', '==', true)))
    for (const d of snap.docs) {
      const l = d.data() as Listing
      // Xoá ô trước rồi mới cộng tiền: xoá lỗi thì không cộng (tránh thu hai lần).
      await fs.deleteDoc(d.ref)
      state.player.gold += l.price
      total += l.price
      bus.emit('notify', { key: 'market.sold', params: { name: l.buyerName ?? '?', qty: l.qty, item: l.item, price: l.price }, good: true })
    }
  } catch (e) {
    console.warn('Collect sales', e)
  }
  if (total) bus.emit('saveRequest', undefined)
  return total
}

/**
 * Mua một món ở sạp bạn. visiting: đang thăm nông trại bạn (trạng thái mở là của bạn), nên
 * vàng trừ và món nhận được ghi chờ, cộng khi về nhà.
 */
export async function buy(state: GameState, owner: string, l: Listing, myName: string, visiting: boolean, myGold = state.player.gold): Promise<boolean> {
  if (!online.cloud) return false
  if (visiting && myGold < l.price) {
    bus.emit('notify', { key: 'notice.noGold' })
    return false
  }
  if (!visiting) {
    if (state.player.gold < l.price) {
      bus.emit('notify', { key: 'notice.noGold' })
      return false
    }
    if (!canFit(state.inventory, l.item, l.qty)) {
      bus.emit('notify', { key: 'notice.bagFull' })
      return false
    }
  }
  const { fs, ref } = await col(owner)
  try {
    await fs.updateDoc(fs.doc(ref, String(l.slot)), { sold: true, buyer: online.cloud.account.uid, buyerName: myName })
  } catch (e) {
    // Người khác vừa mua mất (hoặc chủ sạp vừa cất).
    bus.emit('notify', { key: 'market.gone' })
    console.warn('Buy', e)
    return false
  }
  if (visiting) addPending({ gold: -l.price, item: l.item, qty: l.qty })
  else {
    state.player.gold -= l.price
    addItem(state.inventory, l.item, l.qty)
    bus.emit('saveRequest', undefined)
  }
  bus.emit('notify', { key: 'market.bought', params: { qty: l.qty, item: l.item, price: l.price }, good: true })
  return true
}
