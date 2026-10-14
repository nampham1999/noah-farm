import type { Look } from '../core/look.ts'

/**
 * Lớp nói chuyện với Firebase (Auth + Firestore lite). Thư viện Firebase chỉ được tải
 * khi gọi connect(), nên game chơi một mình không phải tải thêm gì.
 *
 * Dữ liệu (luật bảo mật ở firestore.rules):
 * - users/{uid}: hồ sơ (tên, cấp, ngoại hình, mã bạn bè, lần chơi gần nhất)
 * - codes/{mã}: mã bạn bè → uid
 * - saves/{uid}: bản lưu nén (để chơi nhiều máy và để bạn bè ghé thăm)
 * - users/{uid}/friends/{uid bạn}: danh sách bạn (ghi hai chiều)
 * - users/{uid}/inbox/{người gửi}_{loại}_{ngày}: quà, tưới giúp; mỗi loại mỗi ngày một lần
 */

export const FIREBASE_CONFIG = {
  /** Realtime Database (vị trí người chơi khi gặp nhau); để trống thì tắt tính năng gặp nhau. */
  databaseURL: 'https://nsoft-dfe66-default-rtdb.asia-southeast1.firebasedatabase.app',
  apiKey: 'AIzaSyBpppO6xa2Uc00Jv194RD36sWudtUmFkgk',
  authDomain: 'nsoft-dfe66.firebaseapp.com',
  projectId: 'nsoft-dfe66',
  storageBucket: 'nsoft-dfe66.firebasestorage.app',
  messagingSenderId: '807175980682',
  appId: '1:807175980682:web:ca1c3bba51ac040d500f73',
}

export interface Profile {
  uid: string
  name: string
  level: number
  look: Look | null
  code: string
  lastSeen: number
  /** Số liệu cho bảng xếp hạng (bản cũ chưa có thì thiếu). */
  harvest?: number
  fish?: number
  goldEarned?: number
}

/** Trường dùng để xếp hạng. */
export type RankField = 'level' | 'goldEarned' | 'fish' | 'harvest'

/** Đang chơi nếu hồ sơ được cập nhật trong chừng này ms (game gửi lên khoảng mỗi phút). */
export const ONLINE_WINDOW_MS = 3 * 60_000

export interface InboxItem {
  id: string
  from: string
  fromName: string
  /** gift: quà hằng ngày; help: tưới giúp; note: sổ khách; give: gửi đồ cho lời nhờ giúp. */
  kind: 'gift' | 'help' | 'note' | 'give'
  item?: string
  qty?: number
  /** Sổ khách: khoá câu chúc (vd. guest.p1) để chủ nhà đọc đúng ngôn ngữ của mình. */
  text?: string
}

/** Lời nhờ bạn bè giúp: thiếu bao nhiêu món gì cho đơn hàng; mỗi người chỉ có một lời nhờ đang mở. */
export interface HelpRequest {
  uid: string
  name: string
  item: string
  qty: number
  have: number
  /** Mốc tạo (ms), cũng là mã để mỗi người giúp chỉ gửi một lần cho lời nhờ này. */
  at: number
}

/** Một tin nhắn (kênh Làng hoặc chat riêng). kind 'event' là tin hệ thống (lên cấp, người mới...). */
export interface ChatMessage {
  id: string
  uid: string
  name: string
  text: string
  /** Mili giây; tin vừa gửi chưa có giờ máy chủ thì là giờ máy. */
  at: number
  kind: 'msg' | 'event'
}

/** Mã cuộc trò chuyện riêng của hai người: hai uid xếp theo thứ tự, nối bằng "_". */
export function pairId(a: string, b: string): string {
  return [a, b].sort().join('_')
}

export interface Account {
  uid: string
  anonymous: boolean
  email: string | null
}

export type CloudErrorCode = 'offline' | 'notFound' | 'already' | 'denied' | 'setup' | 'popup' | 'other'

export class CloudError extends Error {
  readonly code: CloudErrorCode
  constructor(code: CloudErrorCode, cause?: unknown) {
    super(code, { cause })
    this.code = code
  }
}

/** Đổi lỗi của Firebase sang vài loại người chơi hiểu được. */
function wrap(e: unknown): CloudError {
  if (e instanceof CloudError) return e
  const code = (e as { code?: string })?.code ?? ''
  if (code.includes('permission-denied')) return new CloudError('denied', e)
  if (code.includes('unavailable') || code.includes('network')) return new CloudError('offline', e)
  if (code.includes('configuration-not-found') || code.includes('operation-not-allowed') || code.includes('unauthorized-domain')) return new CloudError('setup', e)
  if (code.includes('popup')) return new CloudError('popup', e)
  return new CloudError('other', e)
}

type Auth = typeof import('firebase/auth')
type Store = typeof import('firebase/firestore')

/** Ngày thật dạng 20261013, dùng làm mã "mỗi ngày một lần". */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export class Cloud {
  private readonly authLib: Auth
  private readonly fs: Store
  private readonly auth: import('firebase/auth').Auth
  private readonly db: import('firebase/firestore').Firestore
  /** App Firebase dùng chung (cho Realtime Database). */
  readonly app: import('firebase/app').FirebaseApp

  private constructor(app: import('firebase/app').FirebaseApp, authLib: Auth, fs: Store, auth: import('firebase/auth').Auth, db: import('firebase/firestore').Firestore) {
    this.app = app
    this.authLib = authLib
    this.fs = fs
    this.auth = auth
    this.db = db
  }

  /** Tải Firebase, đăng nhập (ẩn danh nếu chưa có tài khoản). */
  static async connect(): Promise<Cloud> {
    try {
      const [{ initializeApp }, authLib, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
      const app = initializeApp(FIREBASE_CONFIG)
      const auth = authLib.getAuth(app)
      await auth.authStateReady()
      if (!auth.currentUser) await authLib.signInAnonymously(auth)
      return new Cloud(app, authLib, fs, auth, fs.getFirestore(app))
    } catch (e) {
      throw wrap(e)
    }
  }

  get account(): Account {
    const u = this.auth.currentUser!
    return { uid: u.uid, anonymous: u.isAnonymous, email: u.email }
  }

  /**
   * Đăng nhập Google để dùng chung một nông trại trên nhiều máy.
   * Máy đang ẩn danh thì gắn Google vào tài khoản này; nếu Google đó đã có tài khoản
   * (đã chơi trên máy khác) thì chuyển sang tài khoản đó và trả về 'switched'.
   */
  async signInGoogle(): Promise<'linked' | 'switched'> {
    const { GoogleAuthProvider, linkWithPopup, signInWithPopup } = this.authLib
    const provider = new GoogleAuthProvider()
    try {
      await linkWithPopup(this.auth.currentUser!, provider)
      return 'linked'
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      if (code === 'auth/credential-already-in-use' || code === 'auth/provider-already-linked') {
        try {
          await signInWithPopup(this.auth, provider)
          return 'switched'
        } catch (e2) {
          throw wrap(e2)
        }
      }
      throw wrap(e)
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut()
  }

  /** Ghi hồ sơ; giữ mã bạn bè (đặt chỗ ở codes/{mã}, trùng với người khác thì đổi mã). */
  /** Mã bạn bè đã kiểm tra thuộc về mình (khỏi đọc lại mỗi lần đồng bộ). */
  private codeChecked = ''

  async saveProfile(p: Omit<Profile, 'uid' | 'lastSeen'>, newCode: () => string): Promise<string> {
    const { doc, getDoc, setDoc } = this.fs
    const uid = this.account.uid
    try {
      let code = p.code
      for (let tries = 0; tries < 5 && code !== this.codeChecked; tries++) {
        const ref = doc(this.db, 'codes', code)
        const snap = await getDoc(ref)
        if (!snap.exists()) {
          await setDoc(ref, { uid })
          break
        }
        if (snap.data().uid === uid) break
        code = newCode()
      }
      this.codeChecked = code
      await setDoc(doc(this.db, 'users', uid), {
        name: p.name, level: p.level, look: p.look, code, lastSeen: Date.now(),
        harvest: p.harvest ?? 0, fish: p.fish ?? 0, goldEarned: p.goldEarned ?? 0,
      })
      return code
    } catch (e) {
      throw wrap(e)
    }
  }

  async uploadSave(data: string, savedAt: number): Promise<void> {
    const { doc, setDoc } = this.fs
    try {
      await setDoc(doc(this.db, 'saves', this.account.uid), { data, savedAt })
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Bản lưu trên mây của một người (mình hoặc bạn); null nếu chưa có. */
  async downloadSave(uid = this.account.uid): Promise<{ data: string; savedAt: number } | null> {
    const { doc, getDoc } = this.fs
    try {
      const snap = await getDoc(doc(this.db, 'saves', uid))
      return snap.exists() ? (snap.data() as { data: string; savedAt: number }) : null
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Kết bạn bằng mã: ghi vào danh sách của cả hai người. */
  async addFriend(code: string): Promise<Profile> {
    const { doc, getDoc, setDoc } = this.fs
    const me = this.account.uid
    try {
      const snap = await getDoc(doc(this.db, 'codes', code.trim().toLowerCase()))
      if (!snap.exists()) throw new CloudError('notFound')
      const uid = snap.data().uid as string
      if (uid === me) throw new CloudError('notFound')
      const since = Date.now()
      await setDoc(doc(this.db, 'users', me, 'friends', uid), { since })
      await setDoc(doc(this.db, 'users', uid, 'friends', me), { since })
      const profile = await this.profile(uid)
      if (!profile) throw new CloudError('notFound')
      return profile
    } catch (e) {
      throw wrap(e)
    }
  }

  async profile(uid: string): Promise<Profile | null> {
    const { doc, getDoc } = this.fs
    const snap = await getDoc(doc(this.db, 'users', uid))
    return snap.exists() ? ({ uid, ...snap.data() } as Profile) : null
  }

  /** Người chơi đứng đầu theo một chỉ số (cả làng). */
  async topPlayers(field: RankField, n = 20): Promise<Profile[]> {
    const { collection, getDocs, limit, orderBy, query } = this.fs
    try {
      const snap = await getDocs(query(collection(this.db, 'users'), orderBy(field, 'desc'), limit(n)))
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as Profile)
    } catch (e) {
      throw wrap(e)
    }
  }

  async friends(): Promise<Profile[]> {
    const { collection, getDocs } = this.fs
    try {
      const snap = await getDocs(collection(this.db, 'users', this.account.uid, 'friends'))
      const list = await Promise.all(snap.docs.map((d) => this.profile(d.id)))
      return list.filter((p): p is Profile => p !== null).sort((a, b) => b.lastSeen - a.lastSeen)
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Gửi quà hoặc lượt tưới giúp; mỗi loại mỗi ngày một lần cho mỗi bạn (luật Firestore chặn lần thứ hai). */
  /**
   * Gửi thư vào hộp thư của bạn. Mã thư gồm người gửi + loại + ngày (gift/help/note: mỗi ngày
   * một lần) hoặc + mã lời nhờ (give: mỗi lời nhờ một lần); luật Firestore chặn tạo trùng.
   */
  async send(to: string, kind: InboxItem['kind'], fromName: string, extra: { item?: string; qty?: number; text?: string; key?: string } = {}): Promise<void> {
    const { doc, getDoc, setDoc } = this.fs
    const me = this.account.uid
    const ref = doc(this.db, 'users', to, 'inbox', `${me}_${kind}_${extra.key ?? dayKey()}`)
    try {
      const data: Record<string, unknown> = { from: me, fromName, kind, at: Date.now(), read: false }
      if (extra.item) data.item = extra.item
      if (extra.qty) data.qty = extra.qty
      if (extra.text) data.text = extra.text
      await setDoc(ref, data)
    } catch (e) {
      // Ghi đè bị chặn: hôm nay đã gửi rồi (đọc lại để phân biệt với lỗi khác).
      const err = wrap(e)
      if (err.code === 'denied') {
        const exists = await getDoc(ref).then((s) => s.exists(), () => false)
        if (exists) throw new CloudError('already')
      }
      throw err
    }
  }

  /**
   * Lấy thư chưa đọc (quà, tưới giúp) rồi đánh dấu đã đọc. Không xoá ngay để người gửi
   * không gửi lại được trong cùng ngày; thư cũ hơn 7 ngày thì dọn đi.
   */
  async takeInbox(): Promise<InboxItem[]> {
    const { collection, deleteDoc, getDocs, updateDoc } = this.fs
    try {
      const snap = await getDocs(collection(this.db, 'users', this.account.uid, 'inbox'))
      const weekAgo = Date.now() - 7 * 86_400_000
      const items: InboxItem[] = []
      await Promise.all(
        snap.docs.map((d) => {
          const data = d.data()
          if (!data.read) {
            items.push({ id: d.id, ...data } as InboxItem)
            return updateDoc(d.ref, { read: true })
          }
          return typeof data.at === 'number' && data.at < weekAgo ? deleteDoc(d.ref) : null
        }),
      )
      return items
    } catch (e) {
      throw wrap(e)
    }
  }

  // ---- Nhờ giúp ----

  /** Đăng (hoặc thay) lời nhờ giúp của mình. */
  async postRequest(r: Omit<HelpRequest, 'uid' | 'have' | 'at'>): Promise<void> {
    const { doc, setDoc } = this.fs
    const uid = this.account.uid
    try {
      await setDoc(doc(this.db, 'requests', uid), { uid, name: r.name, item: r.item, qty: r.qty, have: 0, at: Date.now() })
    } catch (e) {
      throw wrap(e)
    }
  }

  async cancelRequest(): Promise<void> {
    const { deleteDoc, doc } = this.fs
    try {
      await deleteDoc(doc(this.db, 'requests', this.account.uid))
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Lời nhờ đang mở của các bạn (và của mình). */
  async requests(uids: string[]): Promise<HelpRequest[]> {
    const { doc, getDoc } = this.fs
    try {
      const snaps = await Promise.all(uids.map((u) => getDoc(doc(this.db, 'requests', u))))
      return snaps.filter((s) => s.exists()).map((s) => s.data() as HelpRequest)
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Gửi đồ cho lời nhờ của bạn: cộng số đã có (trong giới hạn) rồi bỏ đồ vào hộp thư người nhờ. */
  async fulfill(req: HelpRequest, n: number, fromName: string): Promise<void> {
    const { doc, increment, updateDoc } = this.fs
    try {
      // Thư trước (mỗi người giúp chỉ một lần cho lời nhờ này), rồi mới cộng số đã có.
      await this.send(req.uid, 'give', fromName, { item: req.item, qty: n, key: String(req.at) })
      await updateDoc(doc(this.db, 'requests', req.uid), { have: increment(n) })
    } catch (e) {
      throw wrap(e)
    }
  }

  /**
   * Xoá dữ liệu online của mình: hồ sơ, mã bạn bè, bản lưu trên mây, lời nhờ, hộp thư,
   * tên mình trong danh sách bạn của người khác, và tin đã gửi ở kênh Làng.
   */
  async deleteMyData(code: string): Promise<void> {
    const { collection, deleteDoc, doc, getDocs, query, where } = this.fs
    const me = this.account.uid
    // Xoá từng phần riêng: một phần lỗi (vd. mã bạn bè chưa từng lưu) không chặn các phần khác.
    const tasks: Promise<unknown>[] = []
    const run = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (e) {
        console.warn('Delete part failed', e)
      }
    }
    await run(async () => {
      const friends = await getDocs(collection(this.db, 'users', me, 'friends'))
      await Promise.all(friends.docs.flatMap((d) => [run(() => deleteDoc(d.ref)), run(() => deleteDoc(doc(this.db, 'users', d.id, 'friends', me)))]))
    })
    await run(async () => {
      const inbox = await getDocs(collection(this.db, 'users', me, 'inbox'))
      await Promise.all(inbox.docs.map((d) => run(() => deleteDoc(d.ref))))
    })
    await run(async () => {
      const said = await getDocs(query(collection(this.db, 'world'), where('uid', '==', me)))
      await Promise.all(said.docs.map((d) => run(() => deleteDoc(d.ref))))
    })
    tasks.push(run(() => deleteDoc(doc(this.db, 'requests', me))), run(() => deleteDoc(doc(this.db, 'saves', me))), run(() => deleteDoc(doc(this.db, 'codes', code))))
    await Promise.all(tasks)
    // Hồ sơ xoá cuối cùng; lỗi ở bước này mới báo cho người chơi.
    try {
      await deleteDoc(doc(this.db, 'users', me))
    } catch (e) {
      throw wrap(e)
    }
  }

  // ---- Chat ----

  private toMessage(d: import('firebase/firestore').QueryDocumentSnapshot): ChatMessage {
    const data = d.data({ serverTimestamps: 'estimate' })
    const at = data.at as { toMillis?: () => number } | null
    return { id: d.id, uid: data.uid, name: data.name, text: data.text, at: at?.toMillis?.() ?? Date.now(), kind: data.kind ?? 'msg' }
  }

  /** Nghe kênh Làng (50 tin gần nhất, cũ trước mới sau). Trả về hàm huỷ nghe. */
  watchWorld(onChange: (list: ChatMessage[]) => void): () => void {
    const { collection, limit, onSnapshot, orderBy, query } = this.fs
    const q = query(collection(this.db, 'world'), orderBy('at', 'desc'), limit(50))
    return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => this.toMessage(d)).reverse()), (e) => console.warn('World chat', e))
  }

  async postWorld(name: string, text: string, kind: ChatMessage['kind'] = 'msg'): Promise<void> {
    const { addDoc, collection, serverTimestamp } = this.fs
    try {
      await addDoc(collection(this.db, 'world'), { uid: this.account.uid, name, text, kind, at: serverTimestamp() })
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Nghe cuộc trò chuyện riêng với một người bạn (100 tin gần nhất). */
  watchDm(friendUid: string, onChange: (list: ChatMessage[]) => void): () => void {
    const { collection, limit, onSnapshot, orderBy, query } = this.fs
    const q = query(collection(this.db, 'dms', pairId(this.account.uid, friendUid), 'messages'), orderBy('at', 'desc'), limit(100))
    return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => this.toMessage(d)).reverse()), (e) => console.warn('DM', e))
  }

  async sendDm(friendUid: string, name: string, text: string): Promise<void> {
    const { addDoc, collection, doc, serverTimestamp, setDoc } = this.fs
    const me = this.account.uid
    const pair = pairId(me, friendUid)
    try {
      await addDoc(collection(this.db, 'dms', pair, 'messages'), { uid: me, name, text, kind: 'msg', at: serverTimestamp() })
      // Đầu mục cuộc trò chuyện: tin cuối, để bên kia biết có tin chưa đọc.
      await setDoc(doc(this.db, 'dms', pair), { lastAt: serverTimestamp(), lastFrom: me, lastText: text.slice(0, 80) })
    } catch (e) {
      throw wrap(e)
    }
  }

  /** Nghe đầu mục các cuộc trò chuyện với bạn bè (tin cuối, ai gửi) để đếm tin chưa đọc. */
  watchDmHeads(friendUids: string[], onChange: (heads: Map<string, { lastAt: number; lastFrom: string; lastText: string }>) => void): () => void {
    const { doc, onSnapshot } = this.fs
    const heads = new Map<string, { lastAt: number; lastFrom: string; lastText: string }>()
    const stops = friendUids.map((f) =>
      onSnapshot(
        doc(this.db, 'dms', pairId(this.account.uid, f)),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data({ serverTimestamps: 'estimate' })
            heads.set(f, { lastAt: (d.lastAt as { toMillis(): number }).toMillis(), lastFrom: d.lastFrom, lastText: d.lastText })
          }
          onChange(heads)
        },
        (e) => console.warn('DM head', e),
      ),
    )
    return () => stops.forEach((stop) => stop())
  }
}
