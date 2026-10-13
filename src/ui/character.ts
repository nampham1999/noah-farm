import { bus } from '../core/events.ts'
import { AGES, BEARDS, BODIES, DEFAULT_LOOK, HAIR_STYLES, HATS, PALETTE, randomLook, type Look } from '../core/look.ts'
import type { GameState } from '../core/state.ts'
import { t, tKey } from '../i18n/index.ts'
import type { PanelSpec } from './panel.ts'

/**
 * Tạo nhân vật: chọn mẫu gốc (nông dân Rogue) hoặc tự phối dáng, tuổi, da, tóc, râu, mũ,
 * quần áo. Đổi tới đâu nhân vật trong game đổi tới đó; cửa sổ nằm cạnh màn hình để vẫn thấy.
 */
export function createCharacterPanel(state: GameState, save: () => void, onClose: () => void): PanelSpec {
  const apply = (look: Look | null) => {
    state.player.look = look
    bus.emit('lookChanged', undefined)
    bus.emit('sfx', 'click')
    save()
  }

  return {
    title: () => t('look.title'),
    className: 'panel-backdrop--side',
    onClose,
    render(body, refresh) {
      const look = state.player.look
      const set = (patch: Partial<Look>) => {
        apply({ ...(look ?? DEFAULT_LOOK), ...patch })
        refresh()
      }

      const top = row(body, '')
      top.append(
        chip(`🧑‍🌾 ${t('look.classic')}`, look === null, () => {
          apply(null)
          refresh()
        }),
        chip(`✨ ${t('look.custom')}`, look !== null, () => {
          if (!look) set({})
        }),
        chip(`🎲 ${t('look.random')}`, false, () => {
          apply(randomLook())
          refresh()
        }),
      )
      if (!look) {
        const p = document.createElement('p')
        p.className = 'menu-note'
        p.textContent = t('look.classicHint')
        body.append(p)
        return
      }

      const choices = <T extends string>(title: string, list: readonly T[], value: T | undefined, key: string, onPick: (v: T | undefined) => void, none = false) => {
        const r = row(body, title)
        if (none) r.append(chip(t('look.none'), value === undefined, () => onPick(undefined)))
        for (const v of list) r.append(chip(tKey(`look.${key}.${v}`), value === v, () => onPick(v)))
      }
      const colors = (title: string, list: readonly string[], value: string | undefined, onPick: (c: string) => void) => {
        const r = row(body, title)
        r.classList.add('look-row--colors')
        for (const c of list) {
          const b = document.createElement('button')
          b.className = c === value ? 'look-swatch is-on' : 'look-swatch'
          b.style.background = c
          b.setAttribute('aria-label', c)
          b.addEventListener('click', () => onPick(c))
          r.append(b)
        }
      }

      choices(t('look.body'), BODIES, look.body, 'body', (body) => set({ body: body!, beard: body === 'female' ? undefined : look.beard, dress: body === 'male' ? undefined : look.dress }))
      choices(t('look.age'), AGES, look.age, 'age', (age) => set({ age: age!, beard: age === 'child' ? undefined : look.beard, cane: age === 'elder' ? look.cane : undefined }))
      colors(t('look.skin'), PALETTE.skin, look.skin, (skin) => set({ skin }))
      choices(t('look.hairStyle'), HAIR_STYLES, look.hairStyle, 'hair', (hairStyle) => set({ hairStyle: hairStyle! }))
      if (look.hairStyle !== 'bald' || look.beard) colors(t('look.hairColor'), PALETTE.hair, look.hair, (hair) => set({ hair }))
      if (look.body === 'male' && look.age !== 'child') choices(t('look.beard'), BEARDS, look.beard, 'beard', (beard) => set({ beard }), true)
      choices(t('look.hat'), HATS, look.hat, 'hat', (hat) => set({ hat, hatColor: look.hatColor ?? '#f2c75c' }), true)
      if (look.hat) colors(t('look.hatColor'), PALETTE.cloth, look.hatColor, (hatColor) => set({ hatColor }))
      colors(t('look.shirt'), PALETTE.cloth, look.shirt, (shirt) => set({ shirt }))
      if (look.body === 'female') {
        const r = row(body, t('look.bottom'))
        r.append(
          chip(t('look.pants'), !look.dress, () => set({ dress: undefined })),
          chip(t('look.dress'), look.dress === true, () => set({ dress: true })),
        )
      }
      colors(look.dress ? t('look.dressColor') : t('look.pantsColor'), PALETTE.cloth, look.pants, (pants) => set({ pants }))

      const extras = row(body, t('look.extras'))
      extras.append(chip(`👓 ${t('look.glasses')}`, look.glasses === true, () => set({ glasses: look.glasses ? undefined : true })))
      if (look.age === 'elder') extras.append(chip(`🦯 ${t('look.cane')}`, look.cane === true, () => set({ cane: look.cane ? undefined : true })))
    },
  }
}

function row(body: HTMLElement, title: string): HTMLElement {
  const section = document.createElement('section')
  section.className = 'look-section'
  if (title) {
    const h = document.createElement('h3')
    h.textContent = title
    section.append(h)
  }
  const r = document.createElement('div')
  r.className = 'look-row'
  section.append(r)
  body.append(section)
  return r
}

function chip(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = on ? 'look-chip is-on' : 'look-chip'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
