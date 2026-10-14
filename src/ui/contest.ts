import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { t } from '../i18n/index.ts'
import type { Profile } from '../online/cloud.ts'
import { answer, challenge, contests, type ContestKind } from '../online/contest.ts'
import { online } from '../online/online.ts'
import { closePanel, openPanel } from './panel.ts'

/** Chọn kiểu thách đấu với một người bạn. */
export function openChallenge(state: GameState, friend: Profile): void {
  openPanel({
    title: () => `🏁 ${t('contest.title')}`,
    render(body) {
      const p = document.createElement('p')
      p.className = 'menu-note'
      p.textContent = t('contest.pick', { name: friend.name })
      body.append(p)
      for (const kind of ['fish', 'harvest'] as ContestKind[]) {
        const b = document.createElement('button')
        b.className = 'btn primary contest-kind'
        b.textContent = t(`contest.kind.${kind}`)
        b.addEventListener('click', () => {
          closePanel()
          void challenge(state, friend, kind)
        })
        body.append(b)
      }
    },
  })
}

/** Lời thách gửi tới mình (trong cửa sổ Bạn bè). */
export function renderChallenges(body: HTMLElement, refresh: () => void): void {
  if (contests.incoming.length === 0) return
  const box = document.createElement('section')
  box.className = 'menu-section'
  const h = document.createElement('h3')
  h.textContent = `🏁 ${t('contest.title')}`
  box.append(h)
  for (const c of contests.incoming) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span class="row-main"><strong></strong><span class="muted"></span></span>`
    row.querySelector('strong')!.textContent = t('contest.incoming', { name: c.aName })
    row.querySelector('.muted')!.textContent = t(`contest.kind.${c.kind}`)
    for (const [label, cls, ok] of [[t('trade.accept'), 'btn small primary', true], [t('trade.decline'), 'btn small', false]] as const) {
      const b = document.createElement('button')
      b.className = cls
      b.textContent = label
      b.addEventListener('click', () => {
        b.disabled = true
        void answer(c, ok).then(refresh)
      })
      row.append(b)
    }
    box.append(row)
  }
  body.append(box)
}

/** Thanh tỉ số trên cùng màn hình khi đang thi. */
export function attachContestBar(ui: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'contest-bar'
  bar.hidden = true
  ui.append(bar)
  bus.on('contestChanged', () => {
    const c = contests.live
    const me = online.cloud?.account.uid
    bar.hidden = !c || Date.now() > c.endAt
    if (!c || bar.hidden) return
    const left = Math.max(0, Math.ceil((c.endAt - Date.now()) / 1000))
    const mine = c.a === me ? c.scoreA : c.scoreB
    const theirs = c.a === me ? c.scoreB : c.scoreA
    const other = c.a === me ? c.bName : c.aName
    bar.textContent = `${c.kind === 'fish' ? '🎣' : '🌾'} ${t('rank.you')} ${mine} – ${theirs} ${other} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  })
}
