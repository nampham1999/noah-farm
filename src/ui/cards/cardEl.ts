import { isRed, rankLabel, SUIT_SYMBOLS, suitOf, type Card } from '../../cards/cards.ts'

/** Một lá bài trên bàn; selected = đang chọn, mini = cỡ nhỏ, lg = cỡ lớn, dim = làm tối. */
export function cardEl(c: Card | null, opts: { selected?: boolean; mini?: boolean; lg?: boolean; onClick?: () => void; dim?: boolean; empty?: boolean } = {}): HTMLElement {
  const el = document.createElement(opts.onClick ? 'button' : 'div')
  el.className = 'pc'
  if (c === null) {
    el.classList.add(opts.empty ? 'pc--slot' : 'pc--back')
  } else {
    el.classList.add(isRed(c) ? 'pc--red' : 'pc--black')
    el.dataset.s = SUIT_SYMBOLS[suitOf(c)]
    el.innerHTML = `<span class="pc__r">${rankLabel(c)}</span><span class="pc__s">${SUIT_SYMBOLS[suitOf(c)]}</span>`
  }
  if (opts.selected) el.classList.add('is-selected')
  if (opts.mini) el.classList.add('pc--mini')
  if (opts.lg) el.classList.add('pc--lg')
  if (opts.dim) el.classList.add('is-dim')
  if (opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}

/** Dải hướng dẫn: vàng nổi bật khi đến lượt bạn, mờ khi đang chờ người khác. */
export function banner(text: string, active: boolean): HTMLElement {
  const el = document.createElement('p')
  el.className = 'ct__banner' + (active ? '' : ' is-wait')
  el.textContent = text
  return el
}

const seen = new Map<string, number>()

/**
 * Chạy hoạt ảnh một lần cho mỗi khoá (ván chia bài, lá vừa đánh…) dù giao diện được dựng lại nhiều lần:
 * lần vẽ lại trong khoảng windowMs sau lần đầu tiếp tục hoạt ảnh từ chỗ đang dở (độ trễ âm).
 */
export function animate(el: HTMLElement, cls: string, key: string, windowMs: number, index = 0, stagger = 0): void {
  const t = performance.now()
  if (!seen.has(key)) {
    if (seen.size > 200) seen.clear()
    seen.set(key, t)
  }
  const elapsed = t - seen.get(key)!
  if (elapsed - index * stagger >= windowMs) return
  el.classList.add(cls)
  el.style.animationDelay = `${index * stagger - elapsed}ms`
}

/** Màu ảnh đại diện từ uid. */
export function hueOf(uid: string): number {
  let h = 0
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % 360
  return h
}

/** Tay bài xoè hình quạt (có hoạt ảnh chia bài lần đầu của mỗi ván); groups = chỉ số lá bắt đầu một nhóm (phỏm). */
export function fanHand(cards: HTMLElement[], dealKey?: string, groups?: Set<number>): HTMLElement {
  const hand = document.createElement('div')
  hand.className = 'ct__hand'
  const n = cards.length
  const cardW = window.innerHeight < 520 ? 40 : 46
  const avail = Math.max(220, Math.min(window.innerWidth, 520) - 72)
  const ov = n > 1 ? Math.max(-4, Math.min(cardW * 0.58, (n * cardW - avail) / (n - 1))) : 0
  hand.style.setProperty('--ov', `${ov}px`)
  const mid = (n - 1) / 2
  cards.forEach((c, i) => {
    c.style.setProperty('--rot', `${(i - mid) * Math.min(2.6, 24 / Math.max(1, n))}deg`)
    c.style.setProperty('--dy', `${Math.abs(i - mid) ** 2 * 0.3}px`)
    if (groups?.has(i) && i > 0) c.style.marginLeft = `${10 - ov}px`
    if (dealKey) animate(c, 'is-deal', dealKey, 700, i, 50)
    hand.append(c)
  })
  return hand
}
