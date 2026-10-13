/**
 * Kho key-value thô bên dưới SaveStore. Logic game không gọi trực tiếp lớp này.
 */
export interface StorageBackend {
  readonly name: string
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** Lỗi đầy dung lượng, để báo người chơi và gợi ý xuất file (GDD mục 6.7). */
export class QuotaError extends Error {
  constructor(cause: unknown) {
    super('Storage quota exceeded', { cause })
    this.name = 'QuotaError'
  }
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
}
