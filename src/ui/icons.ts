import { furnIconUrl, img as furnImg, requestFurnIcon } from '../render/furnIcons.ts'
import { CROP_BY_ID, item } from '../data/index.ts'

/**
 * Icon SVG vẽ tay lấy từ bản cũ (cozyfarmy.com). Vật phẩm không có ở đây dùng emoji trong dữ liệu.
 */
export const ITEM_SVG: Record<string, string> = {
  tool_hoe: '<svg viewBox="0 0 32 32"><path d="M7 27 L22 8" stroke="#8a5a2b" stroke-width="3.4" stroke-linecap="round"/><path d="M18 4.5 L28.5 8.5 L27 12.5 L20.5 10 Z" fill="#a5afb8" stroke="#5f6b75" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  tool_watering_can: '<svg viewBox="0 0 32 32"><path d="M10 12 Q15 4.5 20 12" fill="none" stroke="#2f6f9e" stroke-width="2.4" stroke-linecap="round"/><path d="M20 17 L27.5 9.5" stroke="#2f6f9e" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="9" r="2.3" fill="#2f6f9e"/><rect x="6.5" y="12" width="15" height="14" rx="3" fill="#4fa3d9" stroke="#2f6f9e" stroke-width="1.5"/><path d="M9 16 h4" stroke="#bfe3f7" stroke-width="1.6" stroke-linecap="round"/></svg>',
}

/**
 * HTML icon của vật phẩm, theo cách bản cũ vẽ: SVG nếu có, không thì emoji;
 * hạt giống là gói hạt in hình nông sản.
 */
export function itemIconHtml(id: string): string {
  const def = item(id)
  if (def.kind === 'seed') {
    const produce = CROP_BY_ID.get(def.cropId!)!.icon
    return `<span class="icon packet"><span class="packet-art"><span class="emoji">${produce}</span></span></span>`
  }
  if (id.startsWith('furn_')) {
    const fid = id.slice(5)
    const done = furnIconUrl(fid)
    if (!done) requestFurnIcon(fid)
    return `<span class="icon" data-furn="${fid}">${done ? furnImg(fid) : `<span class="emoji">${def.icon}</span>`}</span>`
  }
  return `<span class="icon">${ITEM_SVG[id] ?? `<span class="emoji">${def.icon}</span>`}</span>`
}
