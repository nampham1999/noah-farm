import { bus } from '../core/events.ts'
import { mulberry32 } from '../core/random.ts'
import type { GameState } from '../core/state.ts'
import { ENGINES } from '../cards/index.ts'
import type { Card } from '../cards/cards.ts'
import type { Engine, GameId, Round, Seat } from '../cards/engine.ts'
import { notifyError, online } from './online.ts'

/**
 * Bàn bài ở Khu giải trí, chơi cùng bạn bè qua Firestore (không có máy chủ riêng):
 * - Chủ bàn là "nhà cái" của ván: chia bài, kiểm tra nước đi, tính thắng thua. Người chơi chỉ gửi nước đi.
 * - tables/{id}: thông tin bàn và phần công khai của ván (pubJson). tables/{id}/hands/{uid}: bài kín của từng người.
 *   tables/{id}/seats/{uid}: ghế (ai ngồi bàn). tables/{id}/moves/*: nước đi gửi cho chủ bàn.
 * - Cược: lúc chia bài, mỗi người bị giữ một khoản cọc bằng mức thua tối đa của ván (lưu trong bản lưu).
 *   Hết ván: trả cọc cộng thắng thua. Thoát giữa ván là mất cọc; bàn đóng giữa chừng thì hoàn cọc.
 */

export interface TableMeta {
  id: string
  game: GameId
  host: string
  hostName: string
  stake: number
  status: 'lobby' | 'playing' | 'done'
  round: number
  players: string[]
  updatedAt: number
  /** Thắng thua (vàng) của ván vừa xong, theo uid. */
  results: Record<string, number> | null
}

export interface Session {
  tid: string
  meta: TableMeta
  seats: Seat[]
  pub: Record<string, unknown> | null
  hand: Card[]
  isHost: boolean
  engine: Engine
}

export const cardTable = {
  session: null as Session | null,
  lobby: [] as TableMeta[],
  /** Vừa gửi một nước đi, chưa thấy bàn cập nhật: giao diện tạm khoá nút để khỏi bấm đúp. */
  pending: false,
}

/** Bàn không cập nhật quá lâu coi như chủ bàn đã thoát. */
const STALE_MS = 3 * 60_000
const HEARTBEAT_MS = 30_000
export const STAKES = [1, 2, 5, 10]

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))

const changed = () => bus.emit('cardsChanged', undefined)
const me = (): string => online.cloud!.account.uid

interface HostState {
  round: Round | null
  rand: () => number
  lastHands: Record<string, string>
  timer: number
  lastBeat: number
}
let host: HostState | null = null
let stops: (() => void)[] = []
let lobbyStop: (() => void) | null = null
let gameState: GameState | null = null
const lastSettled = { tid: '', round: -1 }

function db(fs: Fs) {
  return fs.getFirestore(online.cloud!.app)
}

/** Gọi một lần khi online sẵn sàng: nhớ state để trừ/cộng cọc, và dọn cọc của ván dở từ lần trước. */
export async function startCards(state: GameState): Promise<void> {
  gameState = state
  const e = state.cards.escrow
  if (!e || !online.cloud) return
  // Ván dở từ lần chơi trước: còn bàn và còn đúng ván thì nối lại, không thì hoàn cọc / tính kết quả.
  const fs = await lib()
  try {
    const snap = await fs.getDoc(fs.doc(db(fs), 'tables', e.tid))
    const meta = snap.exists() ? ({ id: snap.id, ...snap.data() } as TableMeta) : null
    if (meta && Date.now() - meta.updatedAt < STALE_MS && meta.game in ENGINES) {
      if (meta.round === e.round && meta.results) return void settle(meta)
      if (meta.round === e.round) return void (await attach(meta.id))
    }
    refund('cards.refunded')
  } catch (err) {
    console.warn('Cards resume', err)
  }
}

function refund(key: string): void {
  const state = gameState
  const e = state?.cards.escrow
  if (!state || !e) return
  state.player.gold += e.amount
  state.cards.escrow = null
  bus.emit('notify', { key, params: { gold: e.amount }, good: true })
  bus.emit('saveRequest', undefined)
}

/** Danh sách bàn đang mở (gọi khi mở sảnh, tắt khi đóng). */
export async function watchLobby(on: boolean): Promise<void> {
  lobbyStop?.()
  lobbyStop = null
  if (!on || !online.cloud) return
  const fs = await lib()
  lobbyStop = fs.onSnapshot(
    fs.query(fs.collection(db(fs), 'tables'), fs.where('status', 'in', ['lobby', 'playing'])),
    (snap) => {
      cardTable.lobby = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TableMeta)
        .filter((t) => Date.now() - t.updatedAt < STALE_MS && t.game in ENGINES)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      changed()
    },
    (e) => console.warn('Lobby', e),
  )
}

export async function createTable(state: GameState, game: GameId, stake: number, name: string): Promise<boolean> {
  const engine = ENGINES[game]
  if (!online.cloud || !engine || cardTable.session) return false
  if (!canAfford(state, engine, stake, engine.max)) return false
  const fs = await lib()
  const d = db(fs)
  try {
    const ref = fs.doc(fs.collection(d, 'tables'))
    const meta = { game, host: me(), hostName: name, stake, status: 'lobby', round: 0, players: [name], updatedAt: Date.now(), results: null, pubJson: '' }
    await fs.setDoc(ref, meta)
    await fs.setDoc(fs.doc(d, 'tables', ref.id, 'seats', me()), { name, at: Date.now() })
    await attach(ref.id)
    return true
  } catch (e) {
    notifyError(e)
    return false
  }
}

export async function joinTable(state: GameState, meta: TableMeta, name: string): Promise<boolean> {
  const engine = ENGINES[meta.game]
  if (!online.cloud || !engine || cardTable.session || meta.status !== 'lobby') return false
  if (meta.players.length >= engine.max) {
    bus.emit('notify', { key: 'cards.full' })
    return false
  }
  if (!canAfford(state, engine, meta.stake, engine.max)) return false
  const fs = await lib()
  try {
    await fs.setDoc(fs.doc(db(fs), 'tables', meta.id, 'seats', me()), { name, at: Date.now() })
    await attach(meta.id)
    return true
  } catch (e) {
    notifyError(e)
    return false
  }
}

function canAfford(state: GameState, engine: Engine, stake: number, players: number): boolean {
  const need = engine.maxLoss(stake, players)
  if (state.player.gold >= need) return true
  bus.emit('notify', { key: 'cards.needGold', params: { gold: need } })
  return false
}

/** Nghe bàn: thông tin, ghế, bài của mình; chủ bàn thêm nghe nước đi và chạy đồng hồ. */
async function attach(tid: string): Promise<void> {
  const fs = await lib()
  const d = db(fs)
  const uid = me()
  const first = await fs.getDoc(fs.doc(d, 'tables', tid))
  if (!first.exists()) throw new Error('gone')
  const meta0 = { id: tid, ...first.data() } as TableMeta
  const engine = ENGINES[meta0.game]!
  const session: Session = { tid, meta: meta0, seats: [], pub: null, hand: [], isHost: meta0.host === uid, engine }
  cardTable.session = session
  // Bài về trước thông tin bàn thì chờ có số ván khớp mới nhận.
  let handRaw: { cards?: Card[]; round?: number } | undefined
  const applyHand = () => {
    session.hand = handRaw?.round === session.meta.round && handRaw.cards ? handRaw.cards : []
  }
  stops.push(
    fs.onSnapshot(fs.doc(d, 'tables', tid), (snap) => {
      if (!snap.exists()) return void closed()
      const m = { id: tid, ...snap.data() } as TableMeta
      session.meta = m
      const json = (snap.data() as { pubJson?: string }).pubJson
      session.pub = json ? (JSON.parse(json) as Record<string, unknown>) : null
      applyHand()
      cardTable.pending = false
      onRound(session)
      changed()
    }, (e) => console.warn('Table', e)),
    fs.onSnapshot(fs.collection(d, 'tables', tid, 'seats'), (snap) => {
      session.seats = snap.docs.map((s) => ({ uid: s.id, name: (s.data() as { name: string }).name })).sort((a, b) => a.uid.localeCompare(b.uid))
      // Chủ bàn ghi danh sách tên để sảnh hiện được số người.
      if (session.isHost && session.meta.status === 'lobby') void fs.updateDoc(fs.doc(d, 'tables', tid), { players: session.seats.map((s) => s.name), updatedAt: Date.now() }).catch(() => {})
      if (!session.isHost && session.seats.length && !session.seats.some((s) => s.uid === uid) && session.meta.status === 'lobby') closed()
      changed()
    }),
    fs.onSnapshot(fs.doc(d, 'tables', tid, 'hands', uid), (snap) => {
      handRaw = snap.data() as { cards?: Card[]; round?: number } | undefined
      applyHand()
      changed()
    }),
  )
  if (session.isHost) startHosting(session, fs)
  changed()
}

/** Có ván mới thì giữ cọc; có kết quả thì tính tiền. */
function onRound(s: Session): void {
  const state = gameState
  if (!state) return
  const meSeated = s.seats.some((x) => x.uid === me()) || (s.pub?.order as string[] | undefined)?.includes(me())
  if (s.meta.status === 'playing' && s.meta.round > 0 && meSeated && !s.meta.results) {
    const e = state.cards.escrow
    if (!e || e.tid !== s.tid || e.round !== s.meta.round) {
      if (e) refund('cards.refunded')
      const players = (s.pub?.order as string[] | undefined)?.length ?? s.seats.length
      const need = s.engine.maxLoss(s.meta.stake, players)
      const amount = Math.min(need, state.player.gold)
      if (amount > 0) {
        state.player.gold -= amount
        state.cards.escrow = { tid: s.tid, round: s.meta.round, amount }
        bus.emit('saveRequest', undefined)
      }
    }
  }
  if (s.meta.results) settle(s.meta)
}

function settle(meta: TableMeta): void {
  const state = gameState
  const e = state?.cards.escrow
  if (!state || !e || e.tid !== meta.id || e.round !== meta.round || !meta.results) return
  if (lastSettled.tid === meta.id && lastSettled.round === meta.round) return
  lastSettled.tid = meta.id
  lastSettled.round = meta.round
  const delta = meta.results[me()] ?? 0
  state.player.gold += Math.max(0, e.amount + delta)
  state.cards.escrow = null
  state.cards.played++
  if (delta > 0) state.cards.won++
  state.cards.net += delta
  bus.emit('notify', { key: delta >= 0 ? 'cards.won' : 'cards.lost', params: { gold: Math.abs(delta) }, good: delta >= 0 })
  bus.emit('sfx', delta > 0 ? 'levelUp' : 'click')
  bus.emit('saveRequest', undefined)
}

function closed(): void {
  const hadRound = cardTable.session?.meta.status === 'playing' && !cardTable.session.meta.results
  detach()
  if (hadRound) refund('cards.refunded')
  changed()
}

function detach(): void {
  stops.forEach((f) => f())
  stops = []
  if (host) clearInterval(host.timer)
  host = null
  cardTable.session = null
}

/** Rời bàn: người chơi xoá ghế (giữa ván là mất cọc), chủ bàn đóng luôn bàn (hoàn cọc cho mọi người). */
export async function leaveTable(): Promise<void> {
  const s = cardTable.session
  if (!s || !online.cloud) return
  const fs = await lib()
  const d = db(fs)
  const midRound = s.meta.status === 'playing' && !s.meta.results
  try {
    if (s.isHost) {
      for (const seat of s.seats) await fs.deleteDoc(fs.doc(d, 'tables', s.tid, 'seats', seat.uid)).catch(() => {})
      await fs.deleteDoc(fs.doc(d, 'tables', s.tid))
    } else {
      await fs.deleteDoc(fs.doc(d, 'tables', s.tid, 'seats', me()))
    }
  } catch (e) {
    console.warn('Leave', e)
  }
  const state = gameState
  detach()
  // Chủ bàn đóng giữa ván: ván huỷ nên hoàn cọc. Người chơi tự bỏ giữa ván: mất cọc.
  if (state?.cards.escrow) {
    if (s.isHost || !midRound) refund('cards.refunded')
    else {
      state.cards.net -= state.cards.escrow.amount
      state.cards.escrow = null
      state.cards.played++
      bus.emit('notify', { key: 'cards.forfeit' })
      bus.emit('saveRequest', undefined)
    }
  }
  changed()
}

/** Gửi nước đi: chủ bàn xử lý ngay, người khác gửi cho chủ bàn. */
export async function sendMove(move: unknown): Promise<void> {
  const s = cardTable.session
  if (!s || !online.cloud) return
  if (s.isHost) {
    const err = hostMove(me(), move)
    if (err) bus.emit('notify', { key: `cards.err.${err}` })
    return
  }
  const fs = await lib()
  cardTable.pending = true
  changed()
  // Không thấy bàn trả lời sau vài giây thì mở khoá lại để bấm lần nữa.
  window.setTimeout(() => {
    if (cardTable.pending) {
      cardTable.pending = false
      changed()
    }
  }, 4000)
  try {
    await fs.addDoc(fs.collection(db(fs), 'tables', s.tid, 'moves'), { uid: me(), round: s.meta.round, move: JSON.stringify(move), at: Date.now() })
  } catch (e) {
    cardTable.pending = false
    changed()
    notifyError(e)
  }
}

// ───────────── Chủ bàn ─────────────

function startHosting(s: Session, fs: Fs): void {
  const d = db(fs)
  host = { round: null, rand: mulberry32((Date.now() ^ 0x9e3779b9) >>> 0), lastHands: {}, timer: 0, lastBeat: Date.now() }
  stops.push(
    fs.onSnapshot(fs.collection(d, 'tables', s.tid, 'moves'), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue
        const m = ch.doc.data() as { uid: string; round: number; move: string }
        void fs.deleteDoc(ch.doc.ref).catch(() => {})
        if (m.round !== s.meta.round) continue
        try {
          hostMove(m.uid, JSON.parse(m.move))
        } catch {
          /* nước đi hỏng thì bỏ */
        }
      }
    }),
  )
  host.timer = window.setInterval(() => {
    if (!host) return
    if (host.round && s.meta.status === 'playing' && s.engine.tick(host.round, Date.now())) void publish()
    else if (Date.now() - host.lastBeat > HEARTBEAT_MS) {
      host.lastBeat = Date.now()
      void fs.updateDoc(fs.doc(d, 'tables', s.tid), { updatedAt: Date.now() }).catch(() => {})
    }
  }, 1000)
}

/** Chủ bàn bắt đầu (hoặc chơi lại) một ván với những người đang ngồi bàn. */
export async function startRound(): Promise<void> {
  const s = cardTable.session
  if (!s || !s.isHost || !host) return
  if (s.seats.length < s.engine.min) return void bus.emit('notify', { key: 'cards.needPlayers', params: { n: s.engine.min } })
  // Chủ bàn ngồi đầu (làm nhà cái ở Xì dách), những người khác theo thứ tự ghế.
  const seated = [...s.seats.filter((x) => x.uid === s.meta.host), ...s.seats.filter((x) => x.uid !== s.meta.host)]
  host.round = s.engine.deal(seated.slice(0, s.engine.max), host.rand, Date.now())
  host.lastHands = {}
  s.meta = { ...s.meta, round: s.meta.round + 1, status: 'playing', results: null }
  await publish()
}

function hostMove(uid: string, move: unknown): string | null {
  const s = cardTable.session
  if (!s || !host?.round || s.meta.status !== 'playing') return 'closed'
  const err = s.engine.move(host.round, uid, move, Date.now())
  if (!err) void publish()
  return err
}

/** Ghi trạng thái ván lên bàn và bài kín của từng người (chỉ những ai có thay đổi). */
async function publish(): Promise<void> {
  const s = cardTable.session
  if (!s || !host?.round) return
  const fs = await lib()
  const d = db(fs)
  const round = host.round
  const results = s.engine.result(round, s.meta.stake)
  const status = results ? 'done' : 'playing'
  try {
    // Bài và thông tin bàn ghi cùng một lần (một vòng gửi duy nhất, mọi người thấy nhất quán).
    const batch = fs.writeBatch(d)
    for (const [uid, cards] of Object.entries(round.hands)) {
      const json = JSON.stringify(cards)
      if (host.lastHands[uid] === json) continue
      host.lastHands[uid] = json
      batch.set(fs.doc(d, 'tables', s.tid, 'hands', uid), { round: s.meta.round, cards })
    }
    batch.update(fs.doc(d, 'tables', s.tid), {
      round: s.meta.round,
      status,
      results: results ?? null,
      pubJson: JSON.stringify(round.pub),
      players: s.seats.map((x) => x.name),
      updatedAt: Date.now(),
    })
    await batch.commit()
  } catch (e) {
    notifyError(e)
  }
}
