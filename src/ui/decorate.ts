import { bus } from '../core/events.ts'
import { edgesBetween, FLOOR_IDS, FLOOR_SWATCH, hKey, parseEdge, presetPlan, ROOM_TYPES, vKey, WALL_COLORS, WALL_PAINTS, type FloorId, type RoomType, type WallPaint } from '../core/housePlan.ts'
import type { GameState } from '../core/state.ts'
import { ROOM, roomCorner } from '../core/world.ts'
import { itemName, t, tKey } from '../i18n/index.ts'
import type { DesignView, Ghost } from '../render/house.ts'
import { applyPreset, buildWall, canPlace, canPlaceWall, DOOR_COST, eraseWall, furnitureAt, furnitureDef, paintRoom, pickUp, place, planOf, toggleDoor, WALL_COST, wallItemAt } from '../systems/house.ts'
import { countItem } from '../systems/inventory.ts'
import { itemIconHtml } from './icons.ts'

type Mode = 'furniture' | 'wall' | 'door' | 'erase' | 'paint'
type Brush = { kind: 'type'; id: RoomType } | { kind: 'floor'; id: FloorId } | { kind: 'wall'; id: WallPaint }

const ROOM_ICONS: Record<RoomType, string> = { living: '🛋️', bedroom: '🛏️', kitchen: '🍳', bath: '🛁', study: '📚', dining: '🍽️' }

export interface DecorUi {
  readonly active: boolean
  readonly ghost: Ghost | null
  /** Trạng thái công cụ thiết kế (đỉnh lưới, cạnh) để vẽ lớp phủ; null khi đang đặt đồ. */
  readonly design: DesignView | null
  toggle(): void
  close(): void
  /** Chạm vào sàn khi đang thiết kế: tuỳ công cụ đang chọn (đặt đồ, dựng tường, mở cửa, phá tường, sơn phòng). */
  tapWorld(x: number, z: number): void
  /** Chuột rê trên sàn: bóng mờ và điểm bắt đầu đi theo. */
  hoverWorld(x: number, z: number): void
  update(): void
}

/** Chế độ thiết kế nhà trong nhà (GDD mục 3.5): đặt đồ nội thất, dựng tường và cửa tự do, sơn từng phòng. */
export function createDecorUi(ui: HTMLElement, state: GameState): DecorUi {
  let active = false
  let mode: Mode = 'furniture'
  let selected: string | null = null
  let rot = 0
  let cell = { cx: 3, cz: 2 }
  let start: { x: number; z: number } | null = null
  let hoverVertex: { x: number; z: number } | null = null
  let hoverEdge: string | null = null
  let brush: Brush = { kind: 'type', id: 'bedroom' }
  let paintTab: 'type' | 'floor' | 'wall' = 'type'
  let presetConfirm = false
  /** Đồ treo tường đang ngắm: ô, cạnh (0 bắc, 1 tây, 3 đông) gần điểm chạm nhất mà treo được. */
  let wallAim: { cx: number; cz: number; rot: number } | null = null
  let presetTimer = 0

  const tray = document.createElement('div')
  tray.className = 'decor-tray'
  tray.hidden = true
  const head = document.createElement('div')
  head.className = 'decor-tray__head'
  const title = document.createElement('strong')
  const hint = document.createElement('span')
  hint.className = 'decor-tray__hint'
  const rotBtn = document.createElement('button')
  rotBtn.className = 'btn small'
  rotBtn.textContent = '⟳'
  const doneBtn = document.createElement('button')
  doneBtn.className = 'btn small primary'
  doneBtn.textContent = '✓'
  head.append(title, hint, rotBtn, doneBtn)
  const tabs = document.createElement('div')
  tabs.className = 'decor-tabs'
  const list = document.createElement('div')
  list.className = 'decor-tray__list'
  tray.append(head, tabs, list)
  ui.append(tray)

  for (const b of [rotBtn, doneBtn]) b.addEventListener('mousedown', (e) => e.preventDefault())
  rotBtn.addEventListener('click', () => (rot = (rot + 1) % 4))
  doneBtn.addEventListener('click', () => api.close())

  const MODES: { id: Mode; icon: string }[] = [
    { id: 'furniture', icon: '🛋️' },
    { id: 'wall', icon: '🧱' },
    { id: 'door', icon: '🚪' },
    { id: 'erase', icon: '🧽' },
    { id: 'paint', icon: '🎨' },
  ]
  const setMode = (m: Mode) => {
    mode = m
    start = null
    hoverEdge = null
    drawn = ''
    drawTabs()
    draw()
  }
  const drawTabs = () => {
    tabs.replaceChildren(
      ...MODES.map((m) => {
        const b = document.createElement('button')
        b.className = 'btn small tab' + (mode === m.id ? ' is-active' : '')
        b.textContent = `${m.icon} ${t(`decor.tab.${m.id}`)}`
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', () => setMode(m.id))
        return b
      }),
    )
  }

  const chip = (label: string, selectedNow: boolean, onClick: () => void, swatch?: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.className = 'btn small tab' + (selectedNow ? ' is-active' : '')
    if (swatch) {
      const s = document.createElement('span')
      s.className = 'decor-swatch'
      s.style.background = swatch
      b.append(s)
    }
    b.append(label)
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  /** Khung chứa nội dung một công cụ (xếp dọc, khác với khay đồ xếp ngang). */
  const tool = (...parts: HTMLElement[]): HTMLElement => {
    const box = document.createElement('div')
    box.className = 'decor-tool'
    box.append(...parts)
    return box
  }

  let drawn = ''
  const draw = () => {
    if (mode === 'furniture') return drawFurniture()
    const key = `${mode}|${paintTab}|${JSON.stringify(brush)}|${presetConfirm}|${start?.x},${start?.z}|${state.house.level}`
    if (key === drawn) return
    drawn = key
    rotBtn.hidden = true
    const info = document.createElement('p')
    info.className = 'decor-tray__empty'
    if (mode === 'wall') {
      hint.textContent = start ? t('decor.wallEnd') : t('decor.wallStart')
      info.textContent = t('decor.wallInfo', { wall: WALL_COST })
      list.replaceChildren(tool(info))
    } else if (mode === 'door') {
      hint.textContent = t('decor.doorHint')
      info.textContent = t('decor.doorInfo', { door: DOOR_COST })
      list.replaceChildren(tool(info))
    } else if (mode === 'erase') {
      hint.textContent = t('decor.eraseHint')
      info.textContent = t('decor.eraseInfo')
      list.replaceChildren(tool(info))
    } else {
      hint.textContent = t('decor.paintHint')
      const sub = document.createElement('div')
      sub.className = 'decor-subtabs'
      for (const id of ['type', 'floor', 'wall'] as const) sub.append(chip(t(`decor.paint.${id}`), paintTab === id, () => ((paintTab = id), (drawn = ''))))
      const row = document.createElement('div')
      row.className = 'decor-chips'
      if (paintTab === 'type') {
        for (const id of ROOM_TYPES) row.append(chip(`${ROOM_ICONS[id]} ${tKey(`room.${id}`)}`, brush.kind === 'type' && brush.id === id, () => ((brush = { kind: 'type', id }), (drawn = ''))))
      } else if (paintTab === 'floor') {
        for (const id of FLOOR_IDS) row.append(chip(tKey(`floor.${id}`), brush.kind === 'floor' && brush.id === id, () => ((brush = { kind: 'floor', id }), (drawn = '')), FLOOR_SWATCH[id]))
      } else {
        for (const id of WALL_PAINTS) row.append(chip(tKey(`wallpaint.${id}`), brush.kind === 'wall' && brush.id === id, () => ((brush = { kind: 'wall', id }), (drawn = '')), WALL_COLORS[id]))
      }
      const preset = chip(presetConfirm ? t('decor.presetSure') : `📐 ${t('decor.preset')}`, presetConfirm, () => {
        if (!presetConfirm) {
          presetConfirm = true
          clearTimeout(presetTimer)
          presetTimer = window.setTimeout(() => ((presetConfirm = false), (drawn = '')), 3500)
          drawn = ''
          return
        }
        presetConfirm = false
        applyPreset(state, presetPlan(state.house.level))
        drawn = ''
      })
      list.replaceChildren(tool(sub, row, preset))
    }
  }

  const drawFurniture = () => {
    const owned = state.inventory.slots.flatMap((s) => (s && s.id.startsWith('furn_') ? [s.id] : []))
    const ids = [...new Set(owned)]
    const key = `F|${ids.map((id) => `${id}:${countItem(state.inventory, id)}`).join(',')}|${selected}`
    if (key === drawn) return
    drawn = key
    rotBtn.hidden = false
    if (selected && !ids.includes(`furn_${selected}`)) selected = null
    list.replaceChildren(
      ...ids.map((id) => {
        const b = document.createElement('button')
        b.className = 'slot' + (selected === id.slice(5) ? ' selected' : '')
        b.title = itemName(id)
        b.innerHTML = itemIconHtml(id)
        const qty = countItem(state.inventory, id)
        if (qty > 1) {
          const q = document.createElement('span')
          q.className = 'qty'
          q.textContent = String(qty)
          b.append(q)
        }
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', () => {
          selected = selected === id.slice(5) ? null : id.slice(5)
          drawn = ''
          draw()
        })
        return b
      }),
    )
    if (ids.length === 0) {
      const empty = document.createElement('span')
      empty.className = 'decor-tray__empty'
      empty.textContent = t('decor.empty')
      list.append(empty)
    }
    hint.textContent = selected ? t('decor.placeHint', { item: itemName(`furn_${selected}`) }) : t('decor.pickHint')
  }

  const vertexAt = (x: number, z: number) => {
    const c = roomCorner()
    return { x: Math.max(0, Math.min(ROOM.w, Math.round(x - c.x))), z: Math.max(0, Math.min(ROOM.d, Math.round(z - c.z))) }
  }

  /** Cạnh tường đã dựng gần điểm (x, z) nhất (trong nửa ô); null nếu không có. */
  const wallEdgeAt = (x: number, z: number): string | null => {
    const c = roomCorner()
    const fx = x - c.x
    const fz = z - c.z
    const walls = planOf(state, state.player.floor).walls
    const cands: [string, number][] = [
      [hKey(Math.floor(fx), Math.round(fz)), Math.abs(fz - Math.round(fz))],
      [vKey(Math.round(fx), Math.floor(fz)), Math.abs(fx - Math.round(fx))],
    ]
    const hit = cands.filter(([k, dist]) => walls[k] && parseEdge(k, ROOM.w, ROOM.d) && dist < 0.6).sort((a, b) => a[1] - b[1])[0]
    return hit ? hit[0] : null
  }

  /** Chỗ treo gần điểm (x, z) nhất: ô chứa điểm, cạnh bắc/tây/đông còn treo được, chọn cạnh gần điểm nhất. */
  const aimWall = (id: string, x: number, z: number): { cx: number; cz: number; rot: number } | null => {
    const c = roomCorner()
    const fx = x - c.x
    const fz = z - c.z
    const cx = Math.floor(fx)
    const cz = Math.floor(fz)
    const dists: [number, number][] = [[0, fz - cz], [1, fx - cx], [3, cx + 1 - fx]]
    const ok = dists.filter(([rot]) => canPlaceWall(state, id, cx, cz, rot)).sort((a, b) => a[1] - b[1])
    return ok.length ? { cx, cz, rot: ok[0][0] } : null
  }

  const api: DecorUi = {
    get active() {
      return active
    },
    get ghost() {
      if (mode !== 'furniture' || !selected) return null
      if (furnitureDef(selected).kind === 'wall') return { id: selected, ...(wallAim ?? { cx: cell.cx, cz: cell.cz, rot: 0 }) }
      return { id: selected, cx: cell.cx, cz: cell.cz, rot }
    },
    get design() {
      return active && mode !== 'furniture' ? { tool: mode, start, hoverVertex, hoverEdge } : null
    },
    toggle() {
      if (active) api.close()
      else {
        active = true
        mode = 'furniture'
        document.body.classList.add('is-decorating')
        tray.hidden = false
        title.textContent = `🏡 ${t('decor.title')}`
        drawn = ''
        drawTabs()
      }
    },
    close() {
      active = false
      selected = null
      start = null
      document.body.classList.remove('is-decorating')
      tray.hidden = true
    },
    tapWorld(x, z) {
      const c = roomCorner()
      const cx = Math.floor(x - c.x)
      const cz = Math.floor(z - c.z)
      const inside = cx >= 0 && cx < ROOM.w && cz >= 0 && cz < ROOM.d
      if (mode === 'furniture') {
        if (!inside) return
        cell = { cx, cz }
        if (selected && furnitureDef(selected).kind === 'wall') {
          const aim = aimWall(selected, x, z)
          if (!aim) return void bus.emit('notify', { key: 'decor.cantPlaceWall' })
          place(state, selected, aim.cx, aim.cz, aim.rot)
          drawn = ''
          return
        }
        if (selected) {
          if (!canPlace(state, selected, cx, cz, rot)) return void bus.emit('notify', { key: 'decor.cantPlace' })
          place(state, selected, cx, cz, rot)
          drawn = ''
          return
        }
        let i = furnitureAt(state, cx, cz)
        if (i < 0) i = wallItemAt(state, cx, cz)
        if (i >= 0) {
          const id = state.house.furniture[i].id
          if (pickUp(state, i)) bus.emit('notify', { key: 'decor.pickedUp', params: { item: `furn_${id}` } })
          drawn = ''
        }
      } else if (mode === 'wall') {
        const v = vertexAt(x, z)
        if (!start) {
          start = v
        } else if (start.x === v.x && start.z === v.z) {
          start = null
        } else {
          buildWall(state, start, v)
          // Dựng nối tiếp: điểm cuối thành điểm bắt đầu mới (kéo một đường gấp khúc bằng vài lần chạm).
          start = v
        }
        drawn = ''
      } else if (mode === 'door') {
        const k = wallEdgeAt(x, z)
        if (k) toggleDoor(state, k)
        else bus.emit('notify', { key: 'decor.noWall' })
      } else if (mode === 'erase') {
        const k = wallEdgeAt(x, z)
        if (k) eraseWall(state, k)
      } else if (mode === 'paint' && inside) {
        const patch = brush.kind === 'type' ? { t: brush.id } : brush.kind === 'floor' ? { f: brush.id } : { w: brush.id }
        paintRoom(state, cx, cz, patch)
      }
    },
    hoverWorld(x, z) {
      const c = roomCorner()
      const cx = Math.floor(x - c.x)
      const cz = Math.floor(z - c.z)
      if (cx >= 0 && cx < ROOM.w && cz >= 0 && cz < ROOM.d) cell = { cx, cz }
      wallAim = selected && mode === 'furniture' && furnitureDef(selected).kind === 'wall' ? aimWall(selected, x, z) : null
      hoverVertex = mode === 'wall' ? vertexAt(x, z) : null
      hoverEdge = mode === 'door' || mode === 'erase' ? wallEdgeAt(x, z) : null
    },
    update() {
      if (!active) return
      if (!state.player.indoors) return api.close()
      draw()
    },
  }
  void edgesBetween
  return api
}
