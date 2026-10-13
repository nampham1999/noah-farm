import { isQuotaError, QuotaError, type StorageBackend } from './backend.ts'

const DB_NAME = 'cozyfarm'
const STORE = 'kv'

/** IndexedDB: bất đồng bộ, dung lượng lớn, dùng khi nông trại lớn (GDD mục 6.1). */
export class IdbBackend implements StorageBackend {
  readonly name = 'IndexedDB'
  private db: Promise<IDBDatabase> | null = null

  async read(key: string): Promise<string | null> {
    const value = await this.request('readonly', (s) => s.get(key))
    return typeof value === 'string' ? value : null
  }

  async write(key: string, value: string): Promise<void> {
    try {
      await this.request('readwrite', (s) => s.put(value, key))
    } catch (e) {
      throw isQuotaError(e) ? new QuotaError(e) : e
    }
  }

  async remove(key: string): Promise<void> {
    await this.request('readwrite', (s) => s.delete(key))
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        this.db = null
        reject(req.error)
      }
    })
    return this.db
  }

  private async request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? req.error)
      tx.onabort = () => reject(tx.error ?? req.error)
    })
  }
}
