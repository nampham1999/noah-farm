import { bus } from '../core/events.ts'
import { t } from '../i18n/index.ts'

/**
 * Cửa sổ nổi dùng chung cho cửa hàng, túi đồ...; mỗi lúc chỉ mở một cái.
 * render() được gọi lại sau mỗi thay đổi và khi đổi ngôn ngữ.
 */
export interface PanelSpec {
  title(): string
  /** Bắt buộc chọn một lựa chọn trong cửa sổ: không có nút đóng, chạm ra ngoài không đóng. */
  modal?: boolean
  /** Lớp CSS thêm cho nền mờ (ví dụ cửa sổ nằm cạnh màn hình để vẫn thấy nhân vật). */
  className?: string
  /** Gọi khi cửa sổ đóng (bấm nút đóng, mở cửa sổ khác...). */
  onClose?(): void
  render(body: HTMLElement, refresh: () => void): void
}

let root: HTMLElement
let current: { spec: PanelSpec; el: HTMLElement } | null = null

export function initPanels(ui: HTMLElement): void {
  root = ui
  bus.on('langChanged', () => current && draw())
}

export function isPanelOpen(): boolean {
  return current !== null
}

/** Đang mở cửa sổ bắt buộc chọn: game không nhận thao tác nào khác. */
export function isModalOpen(): boolean {
  return current?.spec.modal === true
}

export function openPanel(spec: PanelSpec): void {
  closePanel()
  const el = document.createElement('div')
  el.className = spec.className ? `panel-backdrop ${spec.className}` : 'panel-backdrop'
  // Chạm ra ngoài khung thì đóng.
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el && !spec.modal) closePanel()
  })
  root.append(el)
  current = { spec, el }
  draw()
}

export function closePanel(): void {
  const closing = current
  current?.el.remove()
  current = null
  closing?.spec.onClose?.()
}

/** Mở nếu đang đóng, đóng nếu đang mở chính nó. */
export function togglePanel(spec: PanelSpec): void {
  if (current?.spec === spec) closePanel()
  else openPanel(spec)
}

function draw(): void {
  if (!current) return
  const { spec, el } = current
  // Vẽ lại sau mỗi thao tác: giữ nguyên chỗ đang cuộn tới.
  const scroll = el.querySelector('.panel__body')?.scrollTop ?? 0
  // Khung gỗ có dải ruy băng ghi tiêu đề và nút đóng tròn đỏ, như bản cũ.
  const box = document.createElement('div')
  // Vẽ lại (không phải lần mở đầu) thì không chạy lại hiệu ứng bật lên, tránh khung bị giật.
  box.className = el.firstElementChild ? 'panel framed is-redraw' : 'panel framed'

  const ribbon = document.createElement('div')
  ribbon.className = 'ribbon'
  ribbon.textContent = spec.title()
  box.append(ribbon)

  if (!spec.modal) {
    const close = document.createElement('button')
    close.className = 'close-x'
    close.textContent = '✕'
    close.setAttribute('aria-label', t('close'))
    close.addEventListener('click', closePanel)
    box.append(close)
  }

  const body = document.createElement('div')
  body.className = 'panel__body'
  spec.render(body, draw)

  box.append(body)
  el.replaceChildren(box)
  body.scrollTop = scroll
}
