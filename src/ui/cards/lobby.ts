import type { GameId } from '../../cards/engine.ts'
import { ENGINES, GAME_LIST } from '../../cards/index.ts'
import type { GameState } from '../../core/state.ts'
import { t, tKey } from '../../i18n/index.ts'
import { cardTable, createTable, joinTable, STAKES, watchLobby } from '../../online/cardTable.ts'
import { online } from '../../online/online.ts'
import { bus } from '../../core/events.ts'
import { closePanel } from '../panel.ts'
import type { PanelSpec } from '../panel.ts'

/** Sảnh Khu giải trí: chọn game và mức cược để tạo bàn, hoặc vào bàn của bạn bè. */
export function cardsLobbyPanel(state: GameState): PanelSpec {
  let game: GameId = GAME_LIST[0]
  let stake = STAKES[1]
  let off: (() => void) | null = null
  return {
    title: () => `🃏 ${t('cards.title')}`,
    className: 'panel--cards',
    onClose() {
      off?.()
      off = null
      void watchLobby(false)
    },
    render(body, refresh) {
      if (!off) {
        off = bus.on('cardsChanged', refresh)
        void watchLobby(true)
      }
      if (!online.cloud) {
        const p = document.createElement('p')
        p.className = 'muted'
        p.textContent = t('cards.offline')
        body.append(p)
        return
      }
      const mkTabs = <T extends string | number>(items: T[], current: T, label: (v: T) => string, set: (v: T) => void) => {
        const row = document.createElement('div')
        row.className = 'tabs'
        for (const v of items) {
          const b = document.createElement('button')
          b.className = 'btn small tab' + (v === current ? ' is-active' : '')
          b.textContent = label(v)
          b.addEventListener('click', () => {
            set(v)
            refresh()
          })
          row.append(b)
        }
        return row
      }
      const need = ENGINES[game]!.maxLoss(stake, ENGINES[game]!.max)
      body.append(
        mkTabs(GAME_LIST, game, (g) => tKey(`cards.game.${g}`), (g) => (game = g)),
        mkTabs(STAKES, stake, (s) => `🪙 ${s}`, (s) => (stake = s)),
      )
      const rule = document.createElement('p')
      rule.className = 'panel__hint'
      rule.textContent = `${tKey(`cards.rule.${game}`)} ${t('cards.deposit', { gold: need })}`
      body.append(rule)
      const create = document.createElement('button')
      create.className = 'btn primary'
      create.textContent = `➕ ${t('cards.create')}`
      create.addEventListener('click', () => {
        void createTable(state, game, stake, state.player.name).then((ok) => ok && closePanel())
      })
      body.append(create)

      const h = document.createElement('h3')
      h.className = 'journal-heading'
      h.textContent = t('cards.openTables')
      body.append(h)
      const tables = cardTable.lobby
      if (!tables.length) {
        const p = document.createElement('p')
        p.className = 'muted'
        p.textContent = t('cards.noTables')
        body.append(p)
      }
      for (const tb of tables) {
        const e = ENGINES[tb.game]!
        const row = document.createElement('div')
        row.className = 'row'
        row.innerHTML = '<span class="row-icon"><span class="icon"><span class="emoji">🃏</span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>'
        row.querySelector('strong')!.textContent = `${tKey(`cards.game.${tb.game}`)} · 🪙 ${tb.stake}`
        row.querySelector('.muted')!.textContent = `${tb.hostName} · ${tb.players.length}/${e.max}${tb.status === 'playing' ? ` · ${t('cards.inGame')}` : ''}`
        const join = document.createElement('button')
        join.className = 'btn small primary'
        join.textContent = t('cards.join')
        join.disabled = tb.status !== 'lobby' || tb.players.length >= e.max
        join.addEventListener('click', () => void joinTable(state, tb, state.player.name).then((ok) => ok && closePanel()))
        row.append(join)
        body.append(row)
      }
    },
  }
}
