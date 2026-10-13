import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import { item, MACHINE_BY_ID, type MachineId } from '../data/index.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import { buyMachine, jobsFor, machineState, machineStatus, startJob } from '../systems/machines.ts'
import type { PanelSpec } from './panel.ts'
import { button, iconRow, shopRow } from './shop.ts'

/** Cửa sổ một máy chế biến: chưa mua thì mua; trống thì chọn món; đang làm thì báo giờ xong. */
export function machinePanel(state: GameState, id: MachineId): PanelSpec {
  let open = true
  let timer = 0
  const spec: PanelSpec = {
    title: () => tKey(`machine.${id}`),
    onClose: () => {
      open = false
      clearTimeout(timer)
    },
    render(body, refresh) {
      clearTimeout(timer)
      const def = MACHINE_BY_ID.get(id)!
      const status = machineStatus(state, id, now())
      const hint = (text: string) => {
        const p = document.createElement('p')
        p.className = 'panel__hint'
        p.textContent = text
        body.append(p)
      }
      hint(tKey(`machine.desc.${id}`))

      if (status === 'missing') {
        const locked = state.player.level < def.level
        const row = iconRow(def.icon, tKey(`machine.${id}`), locked ? t('notice.locked', { level: def.level }) : t('machine.buyHint'))
        row.append(button(`${def.price}g`, 'btn small gold', () => buyMachine(state, id, now()) && refresh(), locked || state.player.gold < def.price))
        body.append(row)
        return
      }

      const m = machineState(state, id)!
      if (status === 'working' && m.output) {
        const left = Math.max(0, m.readyAt - now())
        const winter = id === 'beehive' && state.clock.season === 'winter'
        body.append(shopRow(m.output, itemName(m.output), winter ? t('machine.hiveWinter') : t('machine.timeLeft', { time: formatLeft(left) })))
        // Đếm ngược mỗi giây khi cửa sổ còn mở.
        if (open) timer = window.setTimeout(refresh, 1000)
        return
      }
      if (status === 'ready') {
        hint(t('machine.readyHint'))
        return
      }

      const jobs = jobsFor(state, id)
      if (jobs.length === 0) hint(t(id === 'preserves' ? 'machine.noCrops' : 'machine.noRecipes'))
      for (const job of jobs) {
        const needs = job.needs.map((n) => `${n.icon}×${n.qty}`).join(' + ')
        const out = item(job.output)
        const row = shopRow(job.output, itemName(job.output), `${needs} · ${job.minutes}′ · ${out.sellPrice}g · ⚡${out.energy}`)
        if (!job.take) row.classList.add('locked')
        row.append(button(t('machine.make'), 'btn small primary', () => {
          if (startJob(state, id, job, now())) refresh()
        }, !job.take))
        body.append(row)
      }
    },
  }
  return spec
}

function formatLeft(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
