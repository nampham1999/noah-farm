import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import type { Profile, RankField } from '../online/cloud.ts'
import { notifyError, online, refreshFriends } from '../online/online.ts'
import type { PanelSpec } from './panel.ts'

const FIELDS: { id: RankField; icon: string }[] = [
  { id: 'level', icon: '⭐' },
  { id: 'goldEarned', icon: '💰' },
  { id: 'fish', icon: '🐟' },
  { id: 'harvest', icon: '🌾' },
]
const MEDALS = ['🥇', '🥈', '🥉']

/** Bảng xếp hạng: theo cấp, vàng kiếm được, cá câu được, số lần thu hoạch; bạn bè hoặc cả làng. */
export function leaderboardPanel(state: GameState): PanelSpec {
  let field: RankField = 'level'
  let scope: 'friends' | 'all' = 'friends'
  let all: Profile[] | null = null
  let loading = false

  const load = (refresh: () => void) => {
    if (!online.cloud || loading) return
    loading = true
    void online.cloud.topPlayers(field).then(
      (list) => {
        all = list
        loading = false
        refresh()
      },
      (e: unknown) => {
        loading = false
        notifyError(e)
      },
    )
  }

  return {
    title: () => `🏆 ${t('rank.title')}`,
    render(body, refresh) {
      const scopes = document.createElement('div')
      scopes.className = 'tabs'
      for (const id of ['friends', 'all'] as const) {
        const b = document.createElement('button')
        b.className = 'btn small tab' + (scope === id ? ' is-active' : '')
        b.textContent = t(`rank.scope.${id}`)
        b.addEventListener('click', () => {
          scope = id
          if (id === 'friends') void refreshFriends().then(refresh)
          else load(refresh)
          refresh()
        })
        scopes.append(b)
      }
      const fields = document.createElement('div')
      fields.className = 'tabs'
      for (const f of FIELDS) {
        const b = document.createElement('button')
        b.className = 'btn small tab' + (field === f.id ? ' is-active' : '')
        b.textContent = `${f.icon} ${t(`rank.field.${f.id}`)}`
        b.addEventListener('click', () => {
          field = f.id
          all = null
          if (scope === 'all') load(refresh)
          refresh()
        })
        fields.append(b)
      }
      body.append(scopes, fields)

      const me = online.cloud?.account.uid ?? ''
      const mine: Profile = {
        uid: me, name: state.player.name, level: state.player.level, look: state.player.look, code: state.meta.inviteCode,
        lastSeen: Date.now(), harvest: state.stats.harvest, fish: state.stats.fish, goldEarned: state.stats.goldEarned,
      }
      let list: Profile[]
      if (scope === 'friends') list = [mine, ...online.friends]
      else {
        if (!all) {
          load(refresh)
          body.append(note(t('online.connecting')))
          return
        }
        // Số của mình lấy bản mới nhất trên máy.
        list = all.some((p) => p.uid === me) ? all.map((p) => (p.uid === me ? mine : p)) : all
      }
      const value = (p: Profile) => p[field] ?? 0
      list = [...list].sort((a, b) => value(b) - value(a))

      const rows = document.createElement('div')
      rows.className = 'rows'
      list.forEach((p, i) => {
        const row = document.createElement('div')
        row.className = 'row rank-row' + (p.uid === me ? ' is-me' : '')
        row.innerHTML = `<span class="rank-row__pos"></span><span class="row-main"><strong></strong><span class="muted"></span></span><span class="rank-row__value"></span>`
        row.querySelector('.rank-row__pos')!.textContent = MEDALS[i] ?? `${i + 1}`
        row.querySelector('strong')!.textContent = p.uid === me ? `${p.name} (${t('rank.you')})` : p.name
        row.querySelector('.muted')!.textContent = `${t('rank.field.level')} ${p.level}`
        row.querySelector('.rank-row__value')!.textContent = value(p).toLocaleString('en-US')
        rows.append(row)
      })
      body.append(rows)
      if (scope === 'friends' && online.friends.length === 0) body.append(note(t('online.noFriends')))
    },
  }
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-note'
  p.textContent = text
  return p
}
