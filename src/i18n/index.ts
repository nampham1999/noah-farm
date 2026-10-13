import type { Lang } from '../core/state.ts'
import { item } from '../data/index.ts'
import vi from './vi.json'
import en from './en.json'

export type I18nKey = keyof typeof vi

const dictionaries: Record<Lang, Record<string, string>> = { vi, en }

let current: Lang = 'vi'

export function setLang(lang: Lang): void {
  current = lang
  document.documentElement.lang = lang
}

export function getLang(): Lang {
  return current
}

/** Lấy chữ theo khoá; `{name}` trong chuỗi được thay bằng params.name. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  return tKey(key, params)
}

/** Như t() nhưng nhận khoá ghép lúc chạy (ví dụ `crop.${id}`). */
export function tKey(key: string, params?: Record<string, string | number>): string {
  const text = dictionaries[current][key] ?? dictionaries.vi[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/** Tên vật phẩm theo ngôn ngữ hiện tại. */
export function itemName(id: string): string {
  const def = item(id)
  if (def.kind === 'seed') return t('item.seed', { crop: tKey(`crop.${def.cropId}`) })
  if (def.kind === 'crop') return tKey(`crop.${def.cropId}`)
  return tKey(`item.${id}`)
}

/**
 * Dịch một thông báo từ hệ thống: tham số `item` là id vật phẩm; tham số chuỗi nào
 * trùng khoá i18n (vd. `season.spring`, `animal.cow`) thì được dịch; còn lại giữ nguyên.
 */
export function noticeText(key: string, params?: Record<string, string | number>): string {
  if (!params) return tKey(key)
  const p = { ...params }
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'string') continue
    p[k] = k === 'item' ? itemName(v) : (dictionaries[current][v] ?? dictionaries.vi[v] ?? v)
  }
  return tKey(key, p)
}
