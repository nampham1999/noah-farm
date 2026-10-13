import type { InventoryState, ItemStack } from '../core/state.ts'
import { item } from '../data/index.ts'

const MAX_STACK = 999

export function countItem(inv: InventoryState, id: string): number {
  return inv.slots.reduce((sum, s) => sum + (s?.id === id ? s.qty : 0), 0)
}

/** Thêm vật phẩm, ưu tiên gộp vào ô cùng loại. Trả về số lượng không vừa túi. */
export function addItem(inv: InventoryState, id: string, qty: number): number {
  const stackable = item(id).kind !== 'tool'
  if (stackable) {
    for (const s of inv.slots) {
      if (qty <= 0) break
      if (s?.id === id && s.qty < MAX_STACK) {
        const n = Math.min(qty, MAX_STACK - s.qty)
        s.qty += n
        qty -= n
      }
    }
  }
  for (let i = 0; i < inv.slots.length && qty > 0; i++) {
    if (inv.slots[i]) continue
    const n = stackable ? Math.min(qty, MAX_STACK) : 1
    inv.slots[i] = { id, qty: n }
    qty -= n
  }
  return qty
}

/** Lấy ra đúng `qty` vật phẩm; không đủ thì không lấy gì và trả về false. */
export function removeItem(inv: InventoryState, id: string, qty: number): boolean {
  if (countItem(inv, id) < qty) return false
  // Lấy từ ô cuối trước để giữ nguyên ô trên thanh công cụ lâu nhất.
  for (let i = inv.slots.length - 1; i >= 0 && qty > 0; i--) {
    const s = inv.slots[i]
    if (s?.id !== id) continue
    const n = Math.min(qty, s.qty)
    s.qty -= n
    qty -= n
    if (s.qty === 0) inv.slots[i] = null
  }
  return true
}

/** Còn chỗ cho `qty` vật phẩm này không. */
export function canFit(inv: InventoryState, id: string, qty: number): boolean {
  const stackable = item(id).kind !== 'tool'
  let room = 0
  for (const s of inv.slots) {
    if (!s) room += stackable ? MAX_STACK : 1
    else if (stackable && s.id === id) room += MAX_STACK - s.qty
    if (room >= qty) return true
  }
  return false
}

export function selectedStack(inv: InventoryState): ItemStack | null {
  return inv.slots[inv.selected] ?? null
}
