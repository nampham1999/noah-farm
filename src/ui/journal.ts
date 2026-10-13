import type { GameState } from '../core/state.ts'
import { CROPS, FISH } from '../data/index.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { FESTIVAL_DAY, FESTIVALS, festivalProgress, festivalToday, nextFestival } from '../systems/festival.ts'
import { currentTutorial, dailyReward, dailyTemplate, ensureDaily, questData, statValue } from '../systems/quests.ts'
import { itemIconHtml } from './icons.ts'
import { hearts, likeIcons, MAX_HEARTS, POINTS_PER_HEART } from '../systems/friendship.ts'
import { canDeliver, daysLeft, NPCS } from '../systems/orders.ts'
import type { PanelSpec } from './panel.ts'

type Tab = 'quests' | 'friends' | 'fish' | 'crops' | 'achievements'

/** Nhật ký (phím J, GDD mục 3.7): nhiệm vụ, sổ cá, sổ cây, thành tựu. */
export function createJournalPanel(state: GameState): PanelSpec {
  let tab: Tab = 'quests'

  return {
    title: () => t('journal.title'),
    render(body, refresh) {
      const tabs = document.createElement('div')
      tabs.className = 'tabs'
      for (const id of ['quests', 'friends', 'fish', 'crops', 'achievements'] as const) {
        const b = document.createElement('button')
        b.className = 'btn small tab' + (tab === id ? ' is-active' : '')
        b.textContent = t(`journal.tab.${id}`)
        b.addEventListener('click', () => {
          tab = id
          refresh()
        })
        tabs.append(b)
      }
      const list = document.createElement('div')
      list.className = 'rows'
      body.append(tabs, list)
      if (tab === 'quests') renderQuests(list)
      else if (tab === 'friends') renderFriends(list)
      else if (tab === 'fish') renderFish(list)
      else if (tab === 'crops') renderCrops(list)
      else renderAchievements(list)
    },
  }

  function renderQuests(list: HTMLElement): void {
    const tut = currentTutorial(state)
    if (tut) {
      list.append(heading(t('journal.tutorial')))
      list.append(row(tut.icon, tKey(`quest.${tut.id}`, { n: tut.target }), `${state.quests.progress}/${tut.target} · ${t('journal.reward', { gold: tut.gold, xp: tut.xp })}`, state.quests.progress / tut.target))
    }
    ensureDaily(state)
    // Lễ hội: hôm nay thì hiện thử thách, không thì báo lễ hội kế tiếp.
    const fest = festivalToday(state)
    if (fest) {
      const goal = FESTIVALS[fest]
      const { progress, done: festDone } = festivalProgress(state)
      list.append(heading(`🎉 ${tKey(`festival.${fest}`)}`))
      list.append(row(festDone ? '✅' : goal.icon, tKey(`festival.goal.${fest}`, { n: goal.target }),
        `${Math.min(progress, goal.target)}/${goal.target} · ${t('festival.reward', { gold: goal.gold, item: itemName(`furn_${goal.furniture}`) })}`, progress / goal.target))
    } else {
      const next = nextFestival(state)
      const p = document.createElement('p')
      p.className = 'panel__hint'
      p.textContent = t('festival.next', { name: tKey(`festival.${next.id}`), day: FESTIVAL_DAY, season: tKey(`season.${next.season}`) })
      list.append(p)
    }

    const daily = state.quests.daily
    const done = daily.list.filter((q) => q.progress >= q.target).length
    list.append(heading(t('journal.daily', { done, total: daily.list.length })))
    for (const q of daily.list) {
      const tpl = dailyTemplate(q)
      const finished = q.progress >= q.target
      const r = row(finished ? '✅' : tpl.icon, tKey(`quest.${q.id}`, { n: q.target }), `${q.progress}/${q.target} · ${t('journal.reward', { gold: dailyReward(q), xp: questData.dailyXp })}`, q.progress / q.target)
      if (finished) r.classList.add('done')
      list.append(r)
    }
    list.append(heading(t('journal.orders', { n: state.orders.list.length })))
    for (const o of state.orders.list) {
      const npc = NPCS.find((n) => n.id === o.npc)
      const what = o.lines.map((l) => `${l.qty} ${itemName(l.itemId)}`).join(', ')
      const days = daysLeft(state, o)
      const due = o.rush || days <= 0 ? t('order.today') : t('order.daysLeft', { n: days })
      const r = row(canDeliver(state, o) ? '❗' : (npc?.emoji ?? '📋'), `${tKey(`npc.${o.npc}`)}: ${what}`, `${due} · ${t('journal.reward', { gold: o.gold, xp: o.xp })}`)
      if (canDeliver(state, o)) r.classList.add('done')
      list.append(r)
    }

    const note = document.createElement('p')
    note.className = 'panel__hint'
    note.textContent = daily.bonusClaimed ? t('journal.bonusClaimed') : t('journal.bonusHint', { xp: questData.dailyBonusXp })
    list.append(note)
  }

  function renderFriends(list: HTMLElement): void {
    for (const npc of NPCS) {
      const h = hearts(state, npc.id)
      list.append(row(npc.emoji, tKey(`npc.${npc.id}`), `${'❤️'.repeat(h)}${'🤍'.repeat(MAX_HEARTS - h)} · ${t('friend.likes', { icons: likeIcons(npc.id).join(' ') })}`, (state.friends[npc.id]?.points ?? 0) / (MAX_HEARTS * POINTS_PER_HEART)))
    }
    const p = document.createElement('p')
    p.className = 'panel__hint'
    p.textContent = t('friend.hint')
    list.append(p)
  }

  function renderFish(list: HTMLElement): void {
    const caught = FISH.filter((f) => state.journal.fish[f.id]).length
    list.append(heading(t('journal.fishCount', { n: caught, total: FISH.length })))
    for (const f of FISH) {
      const n = state.journal.fish[f.id] ?? 0
      const where = [
        f.seasons.length ? f.seasons.map((s) => tKey(`season.${s}`)).join(', ') : t('journal.anySeason'),
        f.hours ? t('journal.hours', { from: f.hours[0], to: f.hours[1] }) : t('journal.anyTime'),
        f.level > 1 ? t('notice.locked', { level: f.level }) : '',
      ].filter(Boolean).join(' · ')
      // Chưa câu được thì giấu tên, chỉ hiện gợi ý mùa và giờ.
      const r = n ? itemRow(`fish_${f.id}`, `${itemName(`fish_${f.id}`)} ×${n}`, `${f.price}g · ${where}`) : row('❔', '???', where)
      if (!n) r.classList.add('locked')
      list.append(r)
    }
  }

  function renderCrops(list: HTMLElement): void {
    const grown = CROPS.filter((c) => state.journal.crops[c.id]).length
    list.append(heading(t('journal.cropCount', { n: grown, total: CROPS.length })))
    for (const c of CROPS) {
      const n = state.journal.crops[c.id] ?? 0
      const seasons = c.seasons.map((s) => tKey(`season.${s}`)).join(', ')
      const r = itemRow(`crop_${c.id}`, `${itemName(`crop_${c.id}`)}${n ? ` ×${n}` : ''}`, `${seasons} · ${c.growMinutes} ${t('journal.minutes')} · ${c.sellPrice}g`)
      if (!n) r.classList.add('locked')
      list.append(r)
    }
  }

  function renderAchievements(list: HTMLElement): void {
    const got = state.journal.achievements.length
    list.append(heading(t('journal.achCount', { n: got, total: questData.achievements.length })))
    for (const a of questData.achievements) {
      const value = Math.min(a.target, statValue(state, a.stat))
      const done = state.journal.achievements.includes(a.id)
      const r = row(done ? a.icon : '🔒', tKey(`achievement.${a.id}`), tKey(`achievement.${a.id}.desc`, { n: a.target }) + ` · ${value}/${a.target}`, value / a.target)
      if (done) r.classList.add('done')
      else r.classList.add('locked')
      list.append(r)
    }
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3')
  h.className = 'journal-heading'
  h.textContent = text
  return h
}

function row(emoji: string, name: string, sub: string, fraction?: number): HTMLElement {
  const r = document.createElement('div')
  r.className = 'row'
  r.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji"></span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  r.querySelector('.emoji')!.textContent = emoji
  fill(r, name, sub, fraction)
  return r
}

function itemRow(itemId: string, name: string, sub: string): HTMLElement {
  const r = document.createElement('div')
  r.className = 'row'
  r.innerHTML = `<span class="row-icon">${itemIconHtml(itemId)}</span><span class="row-main"><strong></strong><span class="muted"></span></span>`
  fill(r, name, sub)
  return r
}

function fill(r: HTMLElement, name: string, sub: string, fraction?: number): void {
  r.querySelector('strong')!.textContent = name
  r.querySelector('.muted')!.textContent = sub
  if (fraction !== undefined) {
    const bar = document.createElement('div')
    bar.className = 'xp-bar'
    const inner = document.createElement('div')
    inner.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
    bar.append(inner)
    r.querySelector('.row-main')!.append(bar)
  }
}
