import { t } from '../i18n/index.ts'
import { fishing, stop, strike } from '../systems/fishing.ts'
import type { GameState } from '../core/state.ts'

export interface FishingUi {
  update(): void
}

/**
 * Giao diện câu cá như bản cũ: dòng gợi ý khi chờ, dấu "!" khi cá cắn,
 * thanh kéo cá dọc (vùng xanh, con cá, thanh tiến độ) và nút ✕ để thôi câu.
 * Khi đang kéo, cả màn hình nhận giữ/thả để nâng vùng xanh.
 */
export function createFishingUi(ui: HTMLElement, state: GameState): FishingUi {
  const root = document.createElement('div')
  root.className = 'fishing'
  root.hidden = true
  root.innerHTML = `
    <div class="fishing__hint"></div>
    <div class="fishing__bang">!</div>
    <div class="fishing__reel">
      <div class="fishing__track">
        <div class="fishing__zone"></div>
        <div class="fishing__fish"></div>
      </div>
      <div class="fishing__progress"><div class="fishing__fill"></div></div>
    </div>
    <button class="fishing__stop close-x" type="button">✕</button>`
  ui.append(root)
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
  const hint = $('.fishing__hint')
  const bang = $('.fishing__bang')
  const reel = $('.fishing__reel')
  const zone = $('.fishing__zone')
  const fish = $('.fishing__fish')
  const fill = $('.fishing__fill')
  const stopBtn = $<HTMLButtonElement>('.fishing__stop')

  stopBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
  stopBtn.addEventListener('click', () => stop())

  // Đang kéo: giữ bất kỳ đâu trên màn hình (hoặc Space) để nâng vùng xanh.
  root.addEventListener('pointerdown', (e) => {
    if (fishing.phase === 'reeling') {
      fishing.holding = true
      e.preventDefault()
    } else if (fishing.phase === 'bite') {
      strike(state)
    }
  })
  const release = () => (fishing.holding = false)
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && fishing.phase === 'reeling') fishing.holding = true
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') fishing.holding = false
  })

  let shown = ''
  return {
    update() {
      const phase = fishing.phase
      root.hidden = phase === 'idle'
      root.classList.toggle('is-reeling', phase === 'reeling')
      root.classList.toggle('is-bite', phase === 'bite')
      if (phase === 'idle') return
      const key = `${phase}|${fishing.fish?.id}`
      if (key !== shown) {
        shown = key
        hint.textContent = phase === 'waiting' ? t('fish.waiting') : phase === 'bite' ? t('fish.bite') : t('fish.reelHint')
        bang.hidden = phase !== 'bite'
        reel.hidden = phase !== 'reeling'
        if (fishing.fish) {
          fish.textContent = fishing.fish.icon
          zone.style.height = `${fishing.fish.zone * 100}%`
        }
      }
      if (phase === 'reeling') {
        zone.style.bottom = `${fishing.zoneY * 100}%`
        fish.style.bottom = `calc(${fishing.fishY * 100}% - 14px)`
        fill.style.height = `${Math.max(0, Math.min(1, fishing.progress)) * 100}%`
        const inside = fishing.fishY >= fishing.zoneY && fishing.fishY <= fishing.zoneY + (fishing.fish?.zone ?? 0)
        zone.classList.toggle('is-on', inside)
      }
    },
  }
}
