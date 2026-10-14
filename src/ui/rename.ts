import { bus } from '../core/events.ts'
import { randomFarmerName } from '../core/names.ts'
import type { GameState } from '../core/state.ts'
import { getLang, t } from '../i18n/index.ts'
import { closePanel, openPanel } from './panel.ts'

/** Nhắc người chơi đặt tên (người chơi cũ còn mang tên mặc định, trùng tên cô Mia trong làng). */
export function openRenamePrompt(state: GameState): void {
  let suggestion = randomFarmerName(getLang())
  let name = ''
  openPanel({
    title: () => `✏️ ${t('rename.title')}`,
    render(body, refresh) {
      const p = document.createElement('p')
      p.className = 'menu-note'
      p.textContent = t('rename.hint')
      const input = document.createElement('input')
      input.className = 'menu-input'
      input.maxLength = 20
      input.placeholder = suggestion
      input.value = name
      input.addEventListener('input', () => (name = input.value))
      const dice = document.createElement('button')
      dice.className = 'btn small'
      dice.textContent = '🎲'
      dice.addEventListener('click', () => {
        suggestion = randomFarmerName(getLang())
        name = ''
        refresh()
      })
      const row = document.createElement('div')
      row.className = 'chat-compose__row'
      row.append(input, dice)
      const save = document.createElement('button')
      save.className = 'btn primary'
      save.textContent = t('rename.save')
      save.addEventListener('click', () => {
        state.player.name = (name.trim() || suggestion).slice(0, 20)
        bus.emit('notify', { key: 'rename.done', params: { name: state.player.name }, good: true })
        bus.emit('saveRequest', undefined)
        closePanel()
      })
      body.append(p, row, save)
    },
  })
}
