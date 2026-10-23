import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { parseEdge, roomsOf, styleAt, WALL_COLORS, type FloorId, type HousePlan, type WallPaint } from '../core/housePlan.ts'
import type { GameState } from '../core/state.ts'
import { ENTRY_X, HOUSE_NOW, ROOM, roomCorner, stairsOf } from '../core/world.ts'
import { canPlace, floorCount, footprint, furnitureCenter, furnitureDef, planOf, STAIR_H } from '../systems/house.ts'

const WALL_H = 2.6
/** Chiều cao tường ngăn chạy ngang (cắt thấp để camera nhìn xuyên vào phòng phía sau). */
const HALF_H = 1.15

export interface Ghost {
  id: string
  cx: number
  cz: number
  rot: number
}

/** Trạng thái công cụ thiết kế nhà: hiện các đỉnh lưới, đỉnh bắt đầu đang chọn và cạnh đang trỏ. */
export interface DesignView {
  tool: 'wall' | 'door' | 'erase' | 'paint'
  start: { x: number; z: number } | null
  hoverVertex: { x: number; z: number } | null
  hoverEdge: string | null
}

export interface HouseView {
  update(state: GameState, ghost: Ghost | null, decorating: boolean, design?: DesignView | null): void
}

/**
 * Trong nhà: kiểu cắt mở phía trước (thấy được bên trong từ camera). Sàn, tường, cửa, cầu thang dựng theo bản vẽ người chơi tự thiết kế;
 * đồ nội thất từ mô hình của bản cũ.
 */
export function createHouseView(scene: THREE.Scene, furniture: GLTF, windowModel: THREE.Object3D | null): HouseView {
  const room = new THREE.Group()
  let grid = new THREE.Mesh()
  let builtKey = ''
  let planJson = ''
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const wallMats = new Map<WallPaint, THREE.MeshStandardMaterial>()
  const wallMat = (p: WallPaint) => {
    let m = wallMats.get(p)
    if (!m) wallMats.set(p, (m = new THREE.MeshStandardMaterial({ color: WALL_COLORS[p], roughness: 1 })))
    return m
  }

  // Vỏ nhà dựng theo bản vẽ của tầng đang đứng; sửa bản vẽ, nâng cấp nhà hay đổi tầng thì dựng lại.
  const buildShell = (floor: number, floors: number, plan: HousePlan) => {
    room.clear()
    const w = ROOM.w
    const d = ROOM.d
    builtKey = shellKey(floor, floors, planJson)
    const c = roomCorner()
    const stairSet = stairsOf(HOUSE_NOW.level, floor)

    // Sàn: một tấm phủ cả nhà, mỗi ô vẽ kiểu sàn riêng (khoét lỗ ở chỗ cầu thang xuống).
    const geo = stairSet.down ? floorWithHole(w, d, stairSet.down) : new THREE.PlaneGeometry(w, d)
    const floorMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: floorTexture(plan, w, d), roughness: 0.9, side: THREE.DoubleSide }))
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.set(ROOM.x, 0.02, ROOM.z)
    floorMesh.receiveShadow = true
    room.add(floorMesh)

    grid = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false }),
    )
    grid.rotation.x = -Math.PI / 2
    grid.position.set(ROOM.x, 0.03, ROOM.z)
    room.add(grid)

    const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat)
      m.position.set(x, y, z)
      m.receiveShadow = true
      m.castShadow = shadow
      room.add(m)
      return m
    }

    // Tường ngoài: từng ô một màu theo sơn của ô sát tường.
    for (let cx = 0; cx < w; cx++) box(1.001, WALL_H, 0.2, c.x + cx + 0.5, WALL_H / 2, c.z - 0.1, wallMat(styleAt(plan, cx, 0).w))
    for (let cz = 0; cz < d; cz++) {
      box(0.2, WALL_H, 1.001, c.x - 0.1, WALL_H / 2, c.z + cz + 0.5, wallMat(styleAt(plan, 0, cz).w))
      box(0.2, WALL_H, 1.001, c.x + w + 0.1, WALL_H / 2, c.z + cz + 0.5, wallMat(styleAt(plan, w - 1, cz).w))
    }
    box(w + 0.4, 0.18, 0.24, ROOM.x, 0.09, c.z - 0.08, trimMat)

    // Cửa sổ trên tường bắc, cách nhau, tránh góc có cầu thang.
    if (windowModel) {
      for (let cx = 2; cx < w - 2; cx += 4) {
        const win = windowModel.clone()
        win.position.set(c.x + cx + 0.5, 1.0, c.z + 0.05)
        room.add(win)
      }
    }

    // Tường ngăn và cửa: mỗi mặt tường sơn theo ô ở phía đó. Tường chạy ngang thấp, tường chạy dọc cao.
    for (const [key, kind] of Object.entries(plan.walls)) {
      const e = parseEdge(key, w, d)
      if (!e) continue
      const horizontal = e.axis === 'h'
      const a = horizontal ? { cx: e.cx, cz: e.cz - 1 } : { cx: e.cx - 1, cz: e.cz }
      const b = { cx: e.cx, cz: e.cz }
      const px = horizontal ? c.x + e.cx + 0.5 : c.x + e.cx
      const pz = horizontal ? c.z + e.cz : c.z + e.cz + 0.5
      if (kind === 2) {
        // Cửa: ngưỡng gỗ trên sàn và hai cột khung ở hai đầu đoạn (chỉ vẽ nếu đoạn kế bên không phải cửa).
        box(horizontal ? 1 : 0.22, 0.05, horizontal ? 0.22 : 1, px, 0.03, pz, trimMat)
        for (const s of [-1, 1] as const) {
          const nx = horizontal ? { cx: e.cx + s, cz: e.cz } : { cx: e.cx, cz: e.cz + s }
          const nk = horizontal ? `h:${nx.cx},${nx.cz}` : `v:${nx.cx},${nx.cz}`
          if (plan.walls[nk] === 2) continue
          const postH = horizontal ? HALF_H : WALL_H
          box(0.2, postH, 0.2, horizontal ? px + s * 0.5 : px, postH / 2, horizontal ? pz : pz + s * 0.5, trimMat)
        }
        continue
      }
      const h = horizontal ? HALF_H : WALL_H
      for (const [cell, side] of [[a, -1], [b, 1]] as const) {
        const off = side * 0.045
        box(horizontal ? 1.001 : 0.09, h, horizontal ? 0.09 : 1.001, horizontal ? px : px + off, h / 2, horizontal ? pz + off : pz, wallMat(styleAt(plan, cell.cx, cell.cz).w), true)
      }
      // Nẹp gỗ trên đỉnh tường thấp.
      if (horizontal) box(1.001, 0.05, 0.2, px, h + 0.025, pz, trimMat)
    }

    // Thảm cửa (chỉ tầng trệt, ngay trong cửa ra vào).
    if (floor === 0) {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 1 }))
      mat.rotation.x = -Math.PI / 2
      mat.position.set(c.x + ENTRY_X, 0.035, c.z + d - 0.35)
      room.add(mat)
    }

    // Cầu thang: lên (nếu còn tầng trên) và xuống (nếu không phải tầng trệt).
    const addStairs = (s: { cx: number; cz: number; w: number; d: number }, up: boolean) => {
      const stairs = new THREE.Group()
      const steps = 8
      const dh = STAIR_H / steps
      const sd = s.d / steps
      const wood = new THREE.MeshStandardMaterial({ color: up ? 0xb9854a : 0x9a6a3a, roughness: 1 })
      const dark = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 1 })
      // Bậc từ mép nam (i = 0) tới mép bắc. Lên: bậc cao dần. Xuống: bậc sâu dần dưới sàn, trong lỗ khoét.
      for (let i = 0; i < steps; i++) {
        const z = s.d / 2 - (i + 0.5) * sd
        if (up) {
          const h = dh * (i + 1)
          const step = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, sd), wood)
          step.position.set(0, h / 2, z)
          step.castShadow = true
          stairs.add(step)
        } else {
          const top = -dh * (i + 1)
          const h = STAIR_H + 0.3 + top
          const step = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, sd), wood)
          step.position.set(0, top - h / 2, z)
          stairs.add(step)
        }
      }
      if (!up) {
        for (const dx of [-s.w / 2, s.w / 2]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.06, STAIR_H + 0.3, s.d), dark)
          wall.position.set(dx, -(STAIR_H + 0.3) / 2, 0)
          stairs.add(wall)
        }
        const back = new THREE.Mesh(new THREE.BoxGeometry(s.w, STAIR_H + 0.3, 0.06), dark)
        back.position.set(0, -(STAIR_H + 0.3) / 2, -s.d / 2)
        stairs.add(back)
      }
      if (up) {
        for (const dx of [-s.w / 2, s.w / 2]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, s.d), trimMat)
          rail.position.set(dx, STAIR_H / 2 + 0.55, 0)
          rail.rotation.x = Math.atan2(STAIR_H, s.d)
          stairs.add(rail)
          for (const t of [0.05, 0.5, 0.95]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), trimMat)
            post.position.set(dx, STAIR_H * t + 0.3, s.d / 2 - s.d * t)
            stairs.add(post)
          }
        }
      }
      stairs.position.set(c.x + s.cx + s.w / 2, 0, c.z + s.cz + s.d / 2)
      room.add(stairs)
    }
    if (stairSet.up) addStairs(stairSet.up, true)
    if (stairSet.down) addStairs(stairSet.down, false)

    // Đèn ấm: ở các phòng lớn nhất (tối đa 4 đèn cho nhẹ máy); nhà thông một phòng rộng thì chia hai đèn.
    const rooms = roomsOf(plan, w, d).sort((x, y) => y.cells.length - x.cells.length).slice(0, 4)
    const lamps = rooms.length === 1 && w > 14 ? [{ x: c.x + w * 0.27, z: ROOM.z }, { x: c.x + w * 0.73, z: ROOM.z }] : rooms.map((r) => ({
      x: c.x + r.cells.reduce((s, q) => s + q.cx + 0.5, 0) / r.cells.length,
      z: c.z + r.cells.reduce((s, q) => s + q.cz + 0.5, 0) / r.cells.length,
    }))
    for (const l of lamps) {
      const lamp = new THREE.PointLight(floor === 2 ? 0xffe2b0 : 0xffd6a0, 6, Math.max(8, Math.sqrt(w * d / lamps.length) * 2), 1.6)
      lamp.position.set(l.x, 2.4, l.z)
      room.add(lamp)
    }
  }
  buildShell(0, 1, { walls: {}, cells: {} })
  scene.add(room)

  // Lớp phủ khi thiết kế: các đỉnh lưới, đỉnh bắt đầu, đường xem trước và cạnh đang trỏ.
  const overlay = new THREE.Group()
  scene.add(overlay)
  let overlayKey = ''
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthTest: false })
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xffcd50, depthTest: false })
  const redMat = new THREE.MeshBasicMaterial({ color: 0xe2483a, transparent: true, opacity: 0.8, depthTest: false })
  const drawOverlay = (design: DesignView | null, w: number, d: number) => {
    const key = design ? `${design.tool}|${design.start?.x},${design.start?.z}|${design.hoverVertex?.x},${design.hoverVertex?.z}|${design.hoverEdge}|${w}x${d}` : ''
    if (key === overlayKey) return
    overlayKey = key
    overlay.clear()
    if (!design) return
    const c = roomCorner()
    if (design.tool === 'wall') {
      const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 10), dotMat, (w + 1) * (d + 1))
      const m = new THREE.Matrix4()
      let n = 0
      for (let x = 0; x <= w; x++) {
        for (let z = 0; z <= d; z++) {
          m.makeRotationX(-Math.PI / 2)
          m.setPosition(c.x + x, 0.06, c.z + z)
          dots.setMatrixAt(n++, m)
        }
      }
      dots.renderOrder = 10
      overlay.add(dots)
      const mark = (v: { x: number; z: number }, mat: THREE.Material, r: number) => {
        const s = new THREE.Mesh(new THREE.CircleGeometry(r, 16), mat)
        s.rotation.x = -Math.PI / 2
        s.position.set(c.x + v.x, 0.08, c.z + v.z)
        s.renderOrder = 11
        overlay.add(s)
      }
      if (design.start) mark(design.start, goldMat, 0.22)
      if (design.hoverVertex) mark(design.hoverVertex, design.start ? goldMat : dotMat, 0.17)
      if (design.start && design.hoverVertex) {
        const dx = Math.abs(design.hoverVertex.x - design.start.x)
        const dz = Math.abs(design.hoverVertex.z - design.start.z)
        const horizontal = dx >= dz
        const len = horizontal ? dx : dz
        if (len > 0) {
          const line = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? len : 0.16, horizontal ? 0.16 : len), goldMat)
          line.rotation.x = -Math.PI / 2
          line.position.set(
            c.x + (horizontal ? (design.start.x + design.hoverVertex.x) / 2 : design.start.x),
            0.07,
            c.z + (horizontal ? design.start.z : (design.start.z + design.hoverVertex.z) / 2),
          )
          line.renderOrder = 11
          overlay.add(line)
        }
      }
    }
    if ((design.tool === 'door' || design.tool === 'erase') && design.hoverEdge) {
      const e = parseEdge(design.hoverEdge, w, d)
      if (e) {
        const h = new THREE.Mesh(new THREE.PlaneGeometry(e.axis === 'h' ? 1 : 0.2, e.axis === 'h' ? 0.2 : 1), design.tool === 'erase' ? redMat : goldMat)
        h.rotation.x = -Math.PI / 2
        h.position.set(e.axis === 'h' ? c.x + e.cx + 0.5 : c.x + e.cx, 0.09, e.axis === 'h' ? c.z + e.cz : c.z + e.cz + 0.5)
        h.renderOrder = 11
        overlay.add(h)
      }
    }
  }

  // Đồ đã đặt: dựng lại cả nhóm khi danh sách thay đổi (vài chục món nên rẻ).
  // Đồ đã đặt: dựng lại cả nhóm khi danh sách thay đổi (vài chục món nên rẻ).
  const placed = new THREE.Group()
  scene.add(placed)
  let signature = ''

  const templates = new Map<string, THREE.Object3D>()
  const template = (id: string) => {
    let t = templates.get(id)
    if (!t) {
      const root = furniture.scene.getObjectByName(`FurnRoot_${id}`)
      t = root ? root.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xcccccc }))
      t.position.set(0, 0, 0)
      t.rotation.set(0, 0, 0)
      t.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      templates.set(id, t)
    }
    return t
  }

  // Bóng mờ của món đang định đặt, kèm ô sàn tô xanh (được) hoặc đỏ (không được).
  const ghostRoot = new THREE.Group()
  const ghostCells = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x8fe04d, transparent: true, opacity: 0.45, depthWrite: false }),
  )
  ghostCells.rotation.x = -Math.PI / 2
  scene.add(ghostRoot, ghostCells)
  let ghostKey = ''

  return {
    update(state, ghost, decorating, design = null) {
      const floor = state.player.floor
      const plan = planOf(state, floor)
      // Bản vẽ chỉ đổi khi đang thiết kế (hoặc lúc tải, nâng cấp nhà): ngoài ra dùng lại bản chụp lần trước cho nhẹ.
      if (decorating || planJson === '') planJson = JSON.stringify(plan)
      if (shellKey(floor, floorCount(state), planJson) !== builtKey) buildShell(floor, floorCount(state), plan)
      const indoors = state.player.indoors
      room.visible = placed.visible = indoors
      grid.visible = indoors && decorating
      overlay.visible = indoors && decorating
      drawOverlay(indoors && decorating ? design : null, ROOM.w, ROOM.d)

      const sig = `${state.player.floor}|${JSON.stringify(state.house.furniture)}`
      if (sig !== signature) {
        signature = sig
        placed.clear()
        for (const f of state.house.furniture) {
          if ((f.fl ?? 0) !== state.player.floor) continue
          const obj = template(f.id).clone()
          const p = furnitureCenter(f)
          obj.position.set(p.x, furnitureDef(f.id).kind === 'rug' ? 0.01 : 0, p.z)
          obj.rotation.y = (-f.rot * Math.PI) / 2
          placed.add(obj)
        }
      }

      const show = indoors && decorating && ghost !== null
      ghostRoot.visible = ghostCells.visible = show
      if (!show || !ghost) return
      const key = `${ghost.id}|${ghost.rot}`
      if (key !== ghostKey) {
        ghostKey = key
        ghostRoot.clear()
        const obj = template(ghost.id).clone()
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.material = (Array.isArray(o.material) ? o.material[0] : o.material).clone()
            o.material.transparent = true
            o.material.opacity = 0.6
            o.castShadow = false
          }
        })
        obj.rotation.y = (-ghost.rot * Math.PI) / 2
        ghostRoot.add(obj)
      }
      const center = furnitureCenter(ghost)
      ghostRoot.position.set(center.x, 0.02, center.z)
      const { w, d } = footprint(furnitureDef(ghost.id), ghost.rot)
      ghostCells.scale.set(w, d, 1)
      ghostCells.position.set(center.x, 0.04, center.z)
      ;(ghostCells.material as THREE.MeshBasicMaterial).color.setHex(canPlace(state, ghost.id, ghost.cx, ghost.cz, ghost.rot) ? 0x8fe04d : 0xe2483a)
    },
  }
}

function shellKey(floor: number, floors: number, planJson: string): string {
  return `${HOUSE_NOW.level}|${ROOM.w}x${ROOM.d}|${floor}|${floors}|${planJson}`
}

const hash = (a: number, b: number): number => {
  let h = (a * 73856093) ^ (b * 19349663)
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`
}

const SWATCH: Record<FloorId, string> = {
  plank: '#b9794a', darkwood: '#7a4b2d', tile_white: '#ece8de', tile_green: '#86bd90', tile_blue: '#9ccbd8',
  carpet_red: '#9a5a56', carpet_blue: '#6f81a8', carpet_purple: '#7f6aa5', stone: '#9a968e', marble: '#e4e0e6',
}

/** Vẽ một ô sàn kích thước s tại (x, y) trên canvas theo kiểu sàn. */
function drawFloorCell(g: CanvasRenderingContext2D, id: FloorId, x: number, y: number, s: number, cx: number, cz: number): void {
  const base = SWATCH[id]
  if (id === 'plank' || id === 'darkwood') {
    // Ván gỗ ngang so le, mỗi tấm hơi khác màu.
    const rows = 4
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      const off = ((cz * rows + r) % 2) * (s * 0.4)
      for (const seg of [[-s * 0.4 + off, s * 0.6], [s * 0.2 + off, s * 0.8]] as const) {
        const k = 0.88 + hash(cx * 7 + r, cz * 5 + (seg[0] > 0 ? 1 : 0)) * 0.24
        g.fillStyle = shade(base, k)
        const x0 = Math.max(0, seg[0])
        const x1 = Math.min(s, seg[0] + seg[1] + s * 0.4)
        if (x1 > x0) g.fillRect(x + x0, y + r * h, x1 - x0 - 1.5, h - 1.5)
      }
    }
    return
  }
  if (id.startsWith('tile') || id === 'marble') {
    const half = s / 2
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const alt = (i + j + cx + cz) % 2
        g.fillStyle = id === 'marble' ? shade(base, alt ? 1 : 0.95) : shade(base, alt ? 1.12 : 0.9)
        g.fillRect(x + i * half, y + j * half, half - 1.5, half - 1.5)
      }
    }
    if (id === 'marble') {
      g.strokeStyle = 'rgba(150,140,170,0.35)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(x + hash(cx, cz) * s, y)
      g.lineTo(x + hash(cz, cx) * s, y + s)
      g.stroke()
    }
    return
  }
  if (id === 'stone') {
    const half = s / 2
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = shade(base, 0.85 + hash(cx * 2 + i, cz * 2 + j) * 0.3)
      g.fillRect(x + i * half, y + j * half, half - 2, half - 2)
    }
    return
  }
  // Thảm: nền màu có chấm dệt.
  g.fillStyle = base
  g.fillRect(x, y, s, s)
  g.fillStyle = shade(base, 0.86)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(x + i * (s / 4), y + j * (s / 4), s / 4, s / 4)
}

/** Một texture cho cả sàn nhà: mỗi ô vẽ theo kiểu sàn của nó. */
function floorTexture(plan: HousePlan, w: number, d: number): THREE.CanvasTexture {
  const S = 40
  const cv = document.createElement('canvas')
  cv.width = w * S
  cv.height = d * S
  const g = cv.getContext('2d')!
  for (let cz = 0; cz < d; cz++) for (let cx = 0; cx < w; cx++) drawFloorCell(g, styleAt(plan, cx, cz).f, cx * S, cz * S, S, cx, cz)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Mặt sàn có khoét lỗ chữ nhật (cầu thang xuống), UV chuẩn hoá để vân sàn trải đều như tấm phẳng. */
function floorWithHole(w: number, dz: number, hole: { cx: number; cz: number; w: number; d: number }): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, -dz / 2)
  shape.lineTo(w / 2, -dz / 2)
  shape.lineTo(w / 2, dz / 2)
  shape.lineTo(-w / 2, dz / 2)
  shape.closePath()
  // Sau khi xoay nằm ngang, trục y của hình thành -z của thế giới: lật dấu độ dời theo z.
  const x0 = hole.cx - w / 2
  const x1 = x0 + hole.w
  const y1 = -(hole.cz - dz / 2)
  const y0 = y1 - hole.d
  const h = new THREE.Path()
  h.moveTo(x0, y0)
  h.lineTo(x0, y1)
  h.lineTo(x1, y1)
  h.lineTo(x1, y0)
  h.closePath()
  shape.holes.push(h)
  const geo = new THREE.ShapeGeometry(shape)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + dz / 2) / dz)
  return geo
}

/** Lưới ô khi trang trí. */
function gridTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = ROOM.w * 32
  cv.height = ROOM.d * 32
  const g = cv.getContext('2d')!
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 2
  for (let i = 0; i <= ROOM.w; i++) {
    g.beginPath()
    g.moveTo(i * 32, 0)
    g.lineTo(i * 32, cv.height)
    g.stroke()
  }
  for (let j = 0; j <= ROOM.d; j++) {
    g.beginPath()
    g.moveTo(0, j * 32)
    g.lineTo(cv.width, j * 32)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
