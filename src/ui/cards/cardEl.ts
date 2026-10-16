import { isRed, rankLabel, SUIT_SYMBOLS, suitOf, type Card } from '../../cards/cards.ts'

/** Một lá bài trên bàn; selected = đang chọn, mini = cỡ nhỏ (lá đã lật của người khác). */
export function cardEl(c: Card | null, opts: { selected?: boolean; mini?: boolean; onClick?: () => void; dim?: boolean } = {}): HTMLElement {
  const el = document.createElement(opts.onClick ? 'button' : 'div')
  el.className = 'pc'
  if (c === null) {
    el.classList.add('pc--back')
  } else {
    el.classList.add(isRed(c) ? 'pc--red' : 'pc--black')
    el.innerHTML = `<span class="pc__r">${rankLabel(c)}</span><span class="pc__s">${SUIT_SYMBOLS[suitOf(c)]}</span>`
  }
  if (opts.selected) el.classList.add('is-selected')
  if (opts.mini) el.classList.add('pc--mini')
  if (opts.dim) el.classList.add('is-dim')
  if (opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}

/** Dải hướng dẫn: vàng nổi bật khi đến lượt bạn, mờ khi đang chờ người khác. */
export function banner(text: string, active: boolean): HTMLElement {
  const el = document.createElement('p')
  el.className = 'ct__turn' + (active ? '' : ' is-wait')
  el.textContent = text
  return el
}
