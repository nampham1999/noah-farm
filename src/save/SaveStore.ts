import type { GameState } from '../core/state.ts'
import { QuotaError, type StorageBackend } from './backend.ts'
import { parseSave, peekSavedAt, SaveError, serialize, type ParsedSave, type SaveErrorReason } from './format.ts'
import { IdbBackend } from './idbStore.ts'
import { LocalStorageBackend } from './localStorageStore.ts'

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; save: ParsedSave }
  | { kind: 'broken'; reason: SaveErrorReason; hasBackup: boolean }

/**
 * Giao diện lưu chung (GDD mục 5): mọi lần đọc ghi tiến trình đều đi qua đây.
 * Bản hiện tại lưu trên trình duyệt; sau này thêm backend chỉ cần một bản cài đặt khác.
 */
export interface SaveStore {
  load(): Promise<LoadResult>
  save(state: GameState, savedAt: number): Promise<void>
  /** Chuỗi JSON đầy đủ để xuất file hoặc mã. */
  exportText(state: GameState, savedAt: number): string
  /** Kiểm tra rồi ghi đè bằng dữ liệu từ ngoài; bản đang có được giữ làm bản sao. */
  replace(text: string): Promise<ParsedSave>
  restoreBackup(): Promise<ParsedSave>
  /** Chơi lại từ đầu; bản đang có được giữ làm bản sao. */
  startFresh(): Promise<void>
  /** Tên kho đang giữ bản lưu chính, để hiện trong menu. */
  readonly location: string
}

export const KEYS = {
  main: 'cozyfarm.save.v1',
  backup: 'cozyfarm.save.backup',
  corrupt: 'cozyfarm.save.corrupt',
} as const

/** Bản lưu lớn hơn mức này thì chuyển sang IndexedDB (GDD mục 6.1). */
const LOCAL_LIMIT_CHARS = 1_000_000

/** Lưu trên trình duyệt: localStorage khi nhỏ, IndexedDB khi lớn hoặc khi localStorage đầy. */
export class BrowserSaveStore implements SaveStore {
  private readonly local: StorageBackend = new LocalStorageBackend()
  private readonly idb: StorageBackend = new IdbBackend()
  private persistAsked = false
  location = '-'

  async load(): Promise<LoadResult> {
    const text = await this.readNewest(KEYS.main)
    if (text === null) return { kind: 'empty' }
    try {
      const save = parseSave(text)
      if (save.migratedFrom !== null) {
        // Giữ bản cũ trước khi ghi bản đã nâng cấp (GDD mục 6.5).
        await this.write(KEYS.backup, text)
        await this.save(save.state, save.savedAt)
      }
      return { kind: 'ok', save }
    } catch (e) {
      if (!(e instanceof SaveError)) throw e
      // Không xoá bản hỏng; chép ra chỗ riêng để còn cứu được.
      await this.write(KEYS.corrupt, text).catch(() => {})
      return { kind: 'broken', reason: e.reason, hasBackup: (await this.readNewest(KEYS.backup)) !== null }
    }
  }

  async save(state: GameState, savedAt: number): Promise<void> {
    this.location = await this.write(KEYS.main, serialize(state, savedAt))
    if (!this.persistAsked) {
      this.persistAsked = true
      // Xin trình duyệt đừng tự dọn dữ liệu; không được bảo đảm (GDD mục 6.2).
      navigator.storage?.persist?.().catch(() => {})
    }
  }

  exportText(state: GameState, savedAt: number): string {
    return serialize(state, savedAt)
  }

  async replace(text: string): Promise<ParsedSave> {
    const parsed = parseSave(text)
    await this.keepCurrentAsBackup()
    await this.save(parsed.state, parsed.savedAt)
    return parsed
  }

  async restoreBackup(): Promise<ParsedSave> {
    const text = await this.readNewest(KEYS.backup)
    if (text === null) throw new SaveError('invalid')
    const parsed = parseSave(text)
    await this.save(parsed.state, parsed.savedAt)
    return parsed
  }

  async startFresh(): Promise<void> {
    await this.keepCurrentAsBackup()
    await Promise.all([this.local.remove(KEYS.main), this.idb.remove(KEYS.main).catch(() => {})])
  }

  private async keepCurrentAsBackup(): Promise<void> {
    const current = await this.readNewest(KEYS.main)
    if (current !== null) await this.write(KEYS.backup, current)
  }

  /** Đọc từ cả hai kho, lấy bản có thời điểm lưu mới hơn. */
  private async readNewest(key: string): Promise<string | null> {
    const [a, b] = await Promise.all([this.local.read(key), this.idb.read(key).catch(() => null)])
    if (a === null) {
      if (b !== null) this.location = this.idb.name
      return b
    }
    if (b === null || peekSavedAt(a) >= peekSavedAt(b)) {
      this.location = this.local.name
      return a
    }
    this.location = this.idb.name
    return b
  }

  /** Ghi vào kho phù hợp với kích thước, kho kia làm dự phòng; trả về tên kho đã ghi. */
  private async write(key: string, text: string): Promise<string> {
    const [first, second] = text.length < LOCAL_LIMIT_CHARS ? [this.local, this.idb] : [this.idb, this.local]
    let used = first
    try {
      await first.write(key, text)
    } catch (firstError) {
      used = second
      try {
        await second.write(key, text)
      } catch (secondError) {
        throw firstError instanceof QuotaError ? firstError : secondError
      }
    }
    // Xoá bản ở kho còn lại để lần đọc sau không lấy nhầm bản cũ.
    const other = used === this.local ? this.idb : this.local
    await other.remove(key).catch(() => {})
    return used.name
  }
}
