import type { GameState } from '../core/state.ts'
import { bus } from '../core/events.ts'
import { t, tKey } from '../i18n/index.ts'
import { online } from '../online/online.ts'
import { goalOf, MAX_MONUMENT, village, VILLAGE_REWARD, weekEnd } from '../online/village.ts'
import type { PanelSpec } from './panel.ts'

const MONUMENTS = ['🏗️', '⛲', '🌬️', '🐔']
const MEDALS = ['🥇', '🥈', '🥉']

/** Hội làng: mục tiêu chung tuần này, ai góp nhiều nhất, thưởng và công trình của làng. */
let spec: PanelSpec | null = null

export function villagePanel(state: GameState): PanelSpec {
  if (spec) return spec
  // Tiến độ đổi (ai đó vừa góp) thì vẽ lại nếu đang mở.
  let redraw: (() => void) | null = null
  bus.on('villageChanged', () => redraw?.())
  spec = {
    title: () => `🏘️ ${t('village.title')}`,
    onClose: () => (redraw = null),
    render(body, refresh) {
      redraw = refresh
      if (!online.cloud) {
        body.append(p(t('village.offline'), 'muted'))
        return
      }
      const goal = goalOf(village.week)
      const done = village.progress >= goal.target
      const head = document.createElement('div')
      head.className = 'row'
      const main = document.createElement('div')
      main.className = 'row-main'
      const name = document.createElement('strong')
      name.textContent = `${goal.icon} ${tKey(`village.goal.${goal.type}`, { n: goal.target })}`
      const sub = document.createElement('span')
      sub.className = 'muted'
      const days = Math.max(0, Math.ceil((weekEnd(village.week) - Date.now()) / 86_400_000))
      sub.textContent = `${Math.min(village.progress, goal.target)} / ${goal.target} · ${done ? t('village.reached') : t('village.daysLeft', { n: days })}`
      const bar = document.createElement('div')
      bar.className = 'xp-bar'
      const inner = document.createElement('div')
      inner.style.width = `${Math.min(1, village.progress / goal.target) * 100}%`
      bar.append(inner)
      main.append(name, sub, bar)
      head.append(main)
      body.append(head, p(t('village.reward', { gold: VILLAGE_REWARD }), 'muted'))

      const lvl = Math.min(village.level, MAX_MONUMENT)
      body.append(p(`${MONUMENTS[lvl]} ${tKey(`village.monument.${lvl}`)}${lvl < MAX_MONUMENT ? ` · ${t('village.next', { next: `${MONUMENTS[lvl + 1]} ${tKey(`village.monument.${lvl + 1}`)}` })}` : ''}`))

      const h = document.createElement('h3')
      h.textContent = t('village.top')
      body.append(h)
      const me = online.cloud.account.uid
      const top = Object.entries(village.members).sort((a, b) => b[1].n - a[1].n).slice(0, 8)
      if (!top.length) body.append(p(t('village.none'), 'muted'))
      top.forEach(([uid, m], i) => {
        const row = p(`${MEDALS[i] ?? `${i + 1}.`} ${uid === me ? `${state.player.name} (${t('village.you')})` : m.name} · ${m.n}`)
        body.append(row)
      })
      if (!village.members[me]) body.append(p(t('village.join', { icon: goal.icon }), 'muted'))
    },
  }
  return spec
}

function p(text: string, cls = ''): HTMLElement {
  const e = document.createElement('p')
  if (cls) e.className = cls
  e.textContent = text
  return e
}
