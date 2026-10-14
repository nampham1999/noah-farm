import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { addItem, canFit, countItem, removeItem } from '../systems/inventory.ts'
import { notifyError, online } from './online.ts'

/**
 * Trao đổi đồ giữa bạn bè (Firestore trades/{id}):
 * - Người đề nghị đưa ra món "give", xin món "want"; món give được giữ tạm (rút khỏi túi) ngay.
 * - Người nhận đồng ý (đưa want, nhận give) hoặc từ chối.
 * - Người đề nghị nhận kết quả lần sau mở game / mở cửa sổ Bạn bè: nhận want, hoặc lấy lại give.
 *   Chưa ai trả lời thì người đề nghị tự huỷ được để lấy lại đồ.
 */

export type TradeStatus = 'open' | 'accepted' | 'declined' | 'cancelled' | 'done'

export interface Trade {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  give: { item: string; qty: number }
  want: { item: string; qty: number }
  status: TradeStatus
  at: number
}

export const trades = {
  /** Đề nghị người khác gửi cho mình, đang chờ trả lời. */
  incoming: [] as Trade[],
  /** Đề nghị mình gửi đi, đang chờ trả lời. */
  outgoing: [] as Trade[],
}

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))

function db(fs: Fs) {
  return fs.getFirestore(online.cloud!.app)
}

/** Tải các đề nghị liên quan tới mình; đề nghị mình gửi đã có kết quả thì nhận đồ và đóng lại. */
export async function refreshTrades(state: GameState): Promise<void> {
  const cloud = online.cloud
  if (!cloud) return
  const fs = await lib()
  const me = cloud.account.uid
  try {
    const [inSnap, outSnap] = await Promise.all([
      fs.getDocs(fs.query(fs.collection(db(fs), 'trades'), fs.where('to', '==', me), fs.where('status', '==', 'open'))),
      fs.getDocs(fs.query(fs.collection(db(fs), 'trades'), fs.where('from', '==', me))),
    ])
    trades.incoming = inSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trade)
    const mine = outSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trade)
    trades.outgoing = mine.filter((t) => t.status === 'open')
    for (const t of mine) {
      if (t.status !== 'accepted' && t.status !== 'declined') continue
      // Đóng lại trước, rồi mới cộng đồ: nếu đóng không được thì không cộng (tránh nhận hai lần).
      await fs.updateDoc(fs.doc(db(fs), 'trades', t.id), { status: 'done' })
      const got = t.status === 'accepted' ? t.want : t.give
      addItem(state.inventory, got.item, got.qty)
      bus.emit('notify', { key: t.status === 'accepted' ? 'trade.accepted' : 'trade.declined', params: { name: t.toName, item: got.item, qty: got.qty }, good: t.status === 'accepted' })
      bus.emit('saveRequest', undefined)
    }
    bus.emit('onlineChanged', undefined)
  } catch (e) {
    console.warn('Trades failed', e)
  }
}

export async function proposeTrade(state: GameState, to: { uid: string; name: string }, give: Trade['give'], want: Trade['want']): Promise<boolean> {
  const cloud = online.cloud
  if (!cloud || give.qty <= 0 || want.qty <= 0) return false
  if (countItem(state.inventory, give.item) < give.qty) {
    bus.emit('notify', { key: 'trade.notEnough' })
    return false
  }
  const fs = await lib()
  // Giữ tạm món đưa ra; tạo đề nghị lỗi thì trả lại.
  removeItem(state.inventory, give.item, give.qty)
  try {
    await fs.addDoc(fs.collection(db(fs), 'trades'), {
      from: cloud.account.uid, fromName: state.player.name, to: to.uid, toName: to.name, give, want, status: 'open', at: Date.now(),
    })
  } catch (e) {
    addItem(state.inventory, give.item, give.qty)
    notifyError(e)
    return false
  }
  bus.emit('notify', { key: 'trade.sent', params: { name: to.name }, good: true })
  bus.emit('saveRequest', undefined)
  await refreshTrades(state)
  return true
}

/** Người nhận trả lời: đồng ý (đưa want, nhận give) hoặc từ chối. */
export async function answerTrade(state: GameState, t: Trade, accept: boolean): Promise<boolean> {
  if (accept) {
    if (countItem(state.inventory, t.want.item) < t.want.qty) {
      bus.emit('notify', { key: 'trade.notEnough' })
      return false
    }
    if (!canFit(state.inventory, t.give.item, t.give.qty)) {
      bus.emit('notify', { key: 'notice.bagFull' })
      return false
    }
  }
  const fs = await lib()
  try {
    // Đổi trạng thái trước: luật chỉ cho đổi khi còn "open", nên không ai nhận đồ hai lần.
    await fs.updateDoc(fs.doc(db(fs), 'trades', t.id), { status: accept ? 'accepted' : 'declined' })
  } catch (e) {
    notifyError(e)
    await refreshTrades(state)
    return false
  }
  if (accept) {
    removeItem(state.inventory, t.want.item, t.want.qty)
    addItem(state.inventory, t.give.item, t.give.qty)
    bus.emit('notify', { key: 'trade.done', params: { name: t.fromName, item: t.give.item, qty: t.give.qty }, good: true })
    bus.emit('saveRequest', undefined)
  }
  await refreshTrades(state)
  return true
}

/** Người đề nghị huỷ khi chưa ai trả lời: lấy lại món đã đưa ra. */
export async function cancelTrade(state: GameState, t: Trade): Promise<void> {
  const fs = await lib()
  try {
    await fs.updateDoc(fs.doc(db(fs), 'trades', t.id), { status: 'cancelled' })
    addItem(state.inventory, t.give.item, t.give.qty)
    bus.emit('saveRequest', undefined)
  } catch (e) {
    // Bạn vừa trả lời trước: tải lại để nhận kết quả.
    console.warn('Cancel trade failed', e)
  }
  await refreshTrades(state)
}
