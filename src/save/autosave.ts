import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import { QuotaError } from './backend.ts'
import type { SaveStore } from './SaveStore.ts'

const INTERVAL_MS = 30_000
/** Gom các thao tác lớn liên tiếp (thu hoạch cả luống) thành một lần ghi. */
const DEBOUNCE_MS = 1500

/**
 * Quy tắc ghi (GDD mục 6.7): mỗi 30 giây, khi ẩn hoặc đóng tab, và sau thao tác lớn.
 * Không ghi mỗi khung hình; lỗi ghi được báo cho người chơi.
 */
export class AutoSaver {
  private readonly store: SaveStore
  private readonly state: GameState
  private debounceTimer = 0
  private suspended = false
  private writing: Promise<void> | null = null
  /** Chỉ báo lỗi một lần cho tới khi ghi lại được. */
  private warned = false
  lastSavedAt = 0
  /** Gọi sau mỗi lần lưu thành công (để đồng bộ lên mây). */
  onSaved: ((savedAt: number) => void) | null = null

  constructor(store: SaveStore, state: GameState) {
    this.store = store
    this.state = state
  }

  start(): void {
    window.setInterval(() => void this.saveNow(), INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveNow()
    })
    window.addEventListener('pagehide', () => void this.saveNow())
    bus.on('saveRequest', () => this.requestSoon())
  }

  requestSoon(): void {
    clearTimeout(this.debounceTimer)
    this.debounceTimer = window.setTimeout(() => void this.saveNow(), DEBOUNCE_MS)
  }

  /** Ngừng ghi, dùng trước khi tải lại trang sau khi nhập file hoặc chơi lại từ đầu. */
  suspend(): void {
    this.suspended = true
    clearTimeout(this.debounceTimer)
  }

  async saveNow(): Promise<void> {
    if (this.suspended) return
    // Lần ghi trước chưa xong thì chờ, tránh hai lần ghi chồng nhau.
    if (this.writing) await this.writing
    const savedAt = now()
    this.writing = this.store
      .save(this.state, savedAt)
      .then(() => {
        this.lastSavedAt = savedAt
        this.warned = false
        this.onSaved?.(savedAt)
      })
      .catch((e: unknown) => {
        console.error('Save failed', e)
        if (!this.warned) {
          this.warned = true
          bus.emit('notify', { key: e instanceof QuotaError ? 'save.quota' : 'save.failed' })
        }
      })
      .finally(() => (this.writing = null))
    await this.writing
  }
}
