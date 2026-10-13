/**
 * Nâng cấp dữ liệu lưu qua từng phiên bản (GDD mục 6.5).
 * Khi đổi cấu trúc GameState: tăng SAVE_VERSION và thêm một hàm vào MIGRATIONS,
 * ví dụ `1: migrate_v1_to_v2`. Mỗi hàm nhận dữ liệu bản n, trả về dữ liệu bản n+1.
 */

/** Phiên bản dữ liệu lưu hiện tại; khớp với GameState.version. */
export const SAVE_VERSION = 1

type RawSave = Record<string, unknown> & { version: number }

const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // 1: migrate_v1_to_v2,
}

/** Chạy chuỗi nâng cấp tới bản mới nhất. Ném lỗi nếu thiếu bước nào. */
export function migrate(save: RawSave): RawSave {
  let current = save
  while (current.version < SAVE_VERSION) {
    const step = MIGRATIONS[current.version]
    if (!step) throw new Error(`No migration from v${current.version}`)
    current = step(structuredClone(current))
  }
  return current
}
