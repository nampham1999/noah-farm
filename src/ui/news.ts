import type { GameState } from '../core/state.ts'
import { t, tKey } from '../i18n/index.ts'
import { goalOf, village } from '../online/village.ts'
import { online } from '../online/online.ts'
import { CHECKIN_REWARDS, checkinStatus, claimCheckin } from '../systems/checkin.ts'
import { FESTIVAL_DAY, festivalToday, nextFestival } from '../systems/festival.ts'
import { isRipe } from '../systems/farming.ts'
import { canDeliver } from '../systems/orders.ts'
import { raceAt } from '../systems/race.ts'
import type { PanelSpec } from './panel.ts'

/** Tin làng: điểm danh hằng ngày và tóm tắt những việc đang chờ bạn. */
export function createNewsPanel(state: GameState): PanelSpec {
  return {
    title: () => `📰 ${t('news.title')}`,
    render(body, refresh) {
      const s = checkinStatus(state)
      const box = document.createElement('div')
      box.className = 'checkin'
      const strip = document.createElement('div')
      strip.className = 'checkin__days'
      CHECKIN_REWARDS.forEach((r, i) => {
        const d = document.createElement('div')
        const n = i + 1
        // Ngày đã nhận (trong vòng hiện tại) và ngày sắp nhận.
        const claimed = s.available ? n < s.day : n <= s.day
        d.className = 'checkin__day' + (claimed ? ' is-claimed' : '') + (s.available && n === s.day ? ' is-today' : '')
        d.innerHTML = `<span>${t('checkin.day', { n })}</span><strong>${claimed ? '✅' : n === 7 ? '🎁' : '🪙'}</strong><span>${r.gold}</span>`
        strip.append(d)
      })
      const btn = document.createElement('button')
      btn.className = 'btn primary'
      btn.disabled = !s.available
      btn.textContent = s.available ? `🎁 ${t('checkin.claim', { gold: CHECKIN_REWARDS[s.day - 1].gold })}` : `✅ ${t('checkin.done')}`
      btn.addEventListener('click', () => {
        claimCheckin(state)
        refresh()
      })
      const streak = document.createElement('p')
      streak.className = 'panel__hint'
      streak.textContent = t('checkin.streak', { n: s.streak })
      box.append(strip, btn, streak)
      body.append(box)

      const list = document.createElement('div')
      list.className = 'rows'
      const add = (icon: string, text: string) => {
        const r = document.createElement('div')
        r.className = 'row'
        r.innerHTML = '<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong></span>'
        r.querySelector('.emoji')!.textContent = icon
        r.querySelector('strong')!.textContent = text
        list.append(r)
      }

      const ripe = state.plots.filter(isRipe).length
      if (ripe) add('🌾', t('news.ripe', { n: ripe }))
      const orders = state.orders.list.filter((o) => canDeliver(state, o)).length
      if (orders) add('📋', t('news.orders', { n: orders }))
      const fest = festivalToday(state)
      if (fest) add('🎉', t('news.festivalToday', { name: tKey(`festival.${fest}`) }))
      else {
        const next = nextFestival(state)
        add('🎉', t('festival.next', { name: tKey(`festival.${next.id}`), day: FESTIVAL_DAY, season: tKey(`season.${next.season}`) }))
      }
      const race = raceAt()
      add('🐕', race.phase === 'betting' ? t('news.raceBet', { s: Math.ceil(race.left / 1000) }) : t('news.raceNext', { s: Math.ceil((race.startAt + 180_000 - Date.now()) / 1000) }))
      if (online.cloud && village.loaded) {
        const goal = goalOf(village.week)
        add('🏘️', `${goal.icon} ${Math.min(village.progress, goal.target)}/${goal.target} · ${t('news.village')}`)
      }
      body.append(list)
    },
  }
}
