import { isQuotaError, QuotaError, type StorageBackend } from './backend.ts'

/** localStorage: đơn giản, đồng bộ, khoảng 5 MB mỗi trang (GDD mục 6.1). */
export class LocalStorageBackend implements StorageBackend {
  readonly name = 'localStorage'

  async read(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  async write(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value)
    } catch (e) {
      throw isQuotaError(e) ? new QuotaError(e) : e
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key)
    } catch {
      // Không đọc được localStorage (chế độ riêng tư chặn): coi như đã xoá.
    }
  }
}
