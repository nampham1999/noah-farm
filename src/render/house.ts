import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState } from '../core/state.ts'
import { HOUSE_NOW, MAIN_W, ROOM, roomCorner, solidRanges, stairsOf, type Fixture, type RoomDef } from '../core/world.ts'
import { canPlace, floorCount, footprint, furnitureCenter, furnitureDef } from '../systems/house.ts'
import { createSign } from './animals.ts'

const WALL_H = 2.6

export interface Ghost {
  id: string
  cx: number
  cz: number
  rot: number
}

export interface HouseView {
  update(state: GameState, ghost: Ghost | null, decorating: boolean): void
}

/**
 * Trong nhà: phòng kiểu cắt mở phía trước (thấy được bên trong từ camera), sàn gỗ,
 * tường giấy dán, cửa sổ, thảm cửa, đèn ấm; đồ nội thất từ mô hình của bản cũ.
 */
export function createHouseView(scene: THREE.Scene, furniture: GLTF, windowModel: THREE.Object3D | null): HouseView {
  const room = new THREE.Group()
  // Vỏ nhà dựng theo bố cục (các phòng, vách, đồ cố định, cầu thang) và tầng đang đứng; nâng cấp nhà hay đổi tầng thì dựng lại.
  let grid = new THREE.Mesh()
  let builtKey = ''
  const buildShell = (floor: number, floors: number) => {
    room.clear()
    const layout = HOUSE_NOW.layout
    builtKey = `${HOUSE_NOW.level}|${ROOM.w}x${ROOM.d}|${floor}|${floors}`
    const c = roomCorner()
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
    const livingStyle = roomStyle(layout.rooms.find((r) => r.id === 'living')!, floor)

    // Sàn từng phòng (mỗi phòng một kiểu) và tường ngoài (giấy dán theo phòng).
    const floorTex = (st: Style) => (st.kind === 'tile' ? tileTexture(st) : st.kind === 'carpet' ? carpetTexture(st) : plankTexture(st))
    const mkWall = (w: number, h: number, d: number, x: number, z: number, style: Style, y = h / 2) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: wallpaperTexture(style), roughness: 1 }))
      wall.position.set(x, y, z)
      wall.receiveShadow = true
      wall.castShadow = h < WALL_H
      room.add(wall)
      return wall
    }
    for (const r of layout.rooms) {
      const st = roomStyle(r, floor)
      const w = r.x1 - r.x0
      const dz = r.z1 - r.z0
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, dz), new THREE.MeshStandardMaterial({ map: floorTex(st), roughness: 0.9 }))
      f.rotation.x = -Math.PI / 2
      f.position.set(c.x + r.x0 + w / 2, 0.02, c.z + r.z0 + dz / 2)
      f.receiveShadow = true
      room.add(f)
      // Tường bắc (mặt ngoài phía sau), tường tây và tường đông thuộc phòng này.
      if (r.z0 === 0) mkWall(w + 0.2, WALL_H, 0.2, c.x + r.x0 + w / 2, c.z - 0.1, st)
      if (r.x0 === 0) mkWall(0.2, WALL_H, dz, c.x - 0.1, c.z + r.z0 + dz / 2, st)
      if (r.x1 === ROOM.w) mkWall(0.2, WALL_H, dz, c.x + ROOM.w + 0.1, c.z + r.z0 + dz / 2, st)
      // Cửa sổ trên tường bắc, biển nhỏ ghi loại phòng.
      if (windowModel && r.z0 === 0) {
        const xs = w >= 8 ? [c.x + r.x0 + w * 0.28, c.x + r.x0 + w * 0.72] : [c.x + r.x0 + w / 2]
        for (const x of xs) {
          const win = windowModel.clone()
          win.position.set(x, 1.0, c.z + 0.05)
          room.add(win)
        }
      }
      const sign = createSign(ROOM_ICONS[r.id])
      sign.scale.setScalar(0.9)
      sign.position.set(c.x + r.x0 + w / 2, 2.05, c.z + r.z0 + 0.4)
      room.add(sign)
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.4, 0.18, 0.24), trimMat)
    base.position.set(ROOM.x, 0.09, c.z - 0.08)
    room.add(base)

    grid = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.w, ROOM.d),
      new THREE.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false }),
    )
    grid.rotation.x = -Math.PI / 2
    grid.position.set(ROOM.x, 0.03, ROOM.z)
    room.add(grid)

    // Vách ngăn: đoạn đặc (chừa lối đi); vách thấp ở dãy phía bắc để camera nhìn xuyên qua được, vách cao ở các chỗ còn lại.
    for (const wall of layout.walls) {
      const h = wall.half ? 1.1 : WALL_H
      for (const [a, b] of solidRanges(wall)) {
        const len = b - a
        if (wall.axis === 'z') mkWall(0.2, h, len, c.x + wall.at, c.z + a + len / 2, livingStyle)
        else mkWall(len, h, 0.2, c.x + a + len / 2, c.z + wall.at, livingStyle)
      }
      // Khung cửa ở lối đi: xà ngang (vách cao) hoặc nẹp mép (vách thấp).
      for (const [a, b] of wall.doors) {
        const len = b - a
        const lintel = wall.half
          ? new THREE.Mesh(new THREE.BoxGeometry(wall.axis === 'x' ? len : 0.3, 0.06, wall.axis === 'x' ? 0.3 : len), trimMat)
          : new THREE.Mesh(new THREE.BoxGeometry(wall.axis === 'x' ? len : 0.28, 0.5, wall.axis === 'x' ? 0.28 : len), trimMat)
        const mid = a + len / 2
        lintel.position.set(wall.axis === 'x' ? c.x + mid : c.x + wall.at, wall.half ? 0.03 : WALL_H - 0.25, wall.axis === 'x' ? c.z + wall.at : c.z + mid)
        room.add(lintel)
      }
    }

    // Đồ cố định của bếp và nhà vệ sinh (tầng trệt).
    if (floor === 0) for (const f of layout.fixtures) room.add(buildFixture(f, c.x + f.cx + f.w / 2, c.z + f.cz + f.d / 2))

    // Thảm cửa (chỉ tầng trệt, giữa cạnh nam của phòng khách).
    if (floor === 0) {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 1 }))
      mat.rotation.x = -Math.PI / 2
      mat.position.set(c.x + MAIN_W / 2, 0.035, c.z + ROOM.d - 0.35)
      room.add(mat)
    }

    // Cầu thang: lên (nếu còn tầng trên) và xuống (nếu không phải tầng trệt), kèm biển chỉ tầng.
    const st = stairsOf(HOUSE_NOW.level)
    const addStairs = (s: { cx: number; cz: number; w: number; d: number }, up: boolean, target: number) => {
      const stairs = new THREE.Group()
      const steps = 6
      const wood = new THREE.MeshStandardMaterial({ color: up ? 0xb9854a : 0x9a6a3a, roughness: 1 })
      for (let i = 0; i < steps; i++) {
        const h = 0.22 * (i + 1)
        const step = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, s.d / steps), wood)
        step.position.set(0, h / 2, (s.d / steps) * (steps - 1 - i) - s.d / 2 + s.d / steps / 2)
        step.castShadow = true
        stairs.add(step)
      }
      for (const dx of [-s.w / 2, s.w / 2]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, s.d), trimMat)
        rail.position.set(dx, 0.9, 0)
        stairs.add(rail)
      }
      stairs.position.set(c.x + s.cx + s.w / 2, 0, c.z + s.cz + s.d / 2)
      room.add(stairs)
      const sign = createSign(`${up ? '⬆️' : '⬇️'}${target}`)
      sign.position.set(c.x + s.cx + s.w / 2, 2.15, c.z + s.cz + s.d + 0.1)
      sign.scale.setScalar(1.1)
      room.add(sign)
    }
    if (floor + 1 < floors) addStairs(st.up, true, floor + 2)
    if (floor > 0) addStairs(st.down, false, floor)

    // Đèn ấm: phòng khách, dãy phía bắc và phòng ngủ (ít đèn cho nhẹ máy).
    const lampAt = (x: number, z: number, span: number) => {
      const lamp = new THREE.PointLight(floor === 2 ? 0xffe2b0 : 0xffd6a0, 6, span * 1.5, 1.6)
      lamp.position.set(x, 2.4, z)
      room.add(lamp)
    }
    const living = layout.rooms.find((r) => r.id === 'living')!
    lampAt(c.x + (living.x0 + living.x1) / 2, c.z + (living.z0 + living.z1) / 2, Math.max(living.x1 - living.x0, living.z1 - living.z0))
    const bed = layout.rooms.find((r) => r.id === 'bedroom')
    if (bed) lampAt(c.x + (bed.x0 + bed.x1) / 2, c.z + (bed.z0 + bed.z1) / 2, Math.max(bed.x1 - bed.x0, bed.z1 - bed.z0))
    if (layout.north > 0) lampAt(c.x + ROOM.w / 2, c.z + layout.north / 2, ROOM.w * 0.7)
  }
  buildShell(0, 1)
  scene.add(room)

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
    update(state, ghost, decorating) {
      const shellKey = `${state.house.level}|${ROOM.w}x${ROOM.d}|${state.player.floor}|${floorCount(state)}`
      if (shellKey !== builtKey) buildShell(state.player.floor, floorCount(state))
      const indoors = state.player.indoors
      room.visible = placed.visible = indoors
      grid.visible = indoors && decorating

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

/** Bảng màu mỗi phòng: sàn gỗ, thảm, gạch men và giấy dán tường. */
interface Style {
  plank: [number, number, number]
  carpet: [string, string]
  tile: [string, string]
  wall: [string, string]
  /** Kiểu sàn: ván gỗ, thảm, hay gạch men. */
  kind: 'plank' | 'carpet' | 'tile'
}

const TILE_DEFAULT: [string, string] = ['#efe9dc', '#d8cfbd']

/** Phong cách từng phòng ở tầng trệt (bếp lát gạch, vệ sinh gạch xanh, phòng ngủ trải thảm...). */
function roomStyle(room: RoomDef, floor: number): Style {
  if (floor === 0) {
    switch (room.id) {
      case 'bedroom':
        return { kind: 'carpet', plank: [15, -30, -75], carpet: ['#9a5a56', '#8c4e4b'], tile: TILE_DEFAULT, wall: ['#dfe8f4', '#cddcee'] }
      case 'kitchen':
        return { kind: 'tile', plank: [15, -30, -75], carpet: ['#9a5a56', '#8c4e4b'], tile: ['#f4f1e6', '#86bd90'], wall: ['#fbf0c8', '#f3e3a8'] }
      case 'bath':
        return { kind: 'tile', plank: [15, -30, -75], carpet: ['#9a5a56', '#8c4e4b'], tile: ['#eaf5f8', '#9ccbd8'], wall: ['#d5eef2', '#c2e3ea'] }
      case 'study':
        return { kind: 'plank', plank: [-8, -42, -86], carpet: ['#9a5a56', '#8c4e4b'], tile: TILE_DEFAULT, wall: ['#e6efd9', '#d6e5c4'] }
      default:
        return { kind: 'plank', plank: [15, -30, -75], carpet: ['#9a5a56', '#8c4e4b'], tile: TILE_DEFAULT, wall: ['#f6e3c8', '#efd2c0'] }
    }
  }
  // Tầng trên: mỗi tầng một tông, phòng phía đông trải thảm.
  const f = Math.min(floor, 2)
  const wing = room.x0 >= MAIN_W
  const planks: [number, number, number][] = [[15, -30, -75], [42, 8, -38], [4, -12, -34]]
  const carpets: [string, string][] = [['#9a5a56', '#8c4e4b'], ['#5f9ea0', '#518f91'], ['#7f6aa5', '#715d96']]
  const wallsMain: [string, string][] = [['#f6e3c8', '#efd2c0'], ['#e6efd9', '#d6e5c4'], ['#eadcc0', '#d9c4a0']]
  const wallsWing: [string, string][] = [['#dfe8f4', '#cddcee'], ['#f3e0ee', '#e8cde1'], ['#d9d3ea', '#c7bfe0']]
  return { kind: wing ? 'carpet' : 'plank', plank: planks[f], carpet: carpets[f], tile: TILE_DEFAULT, wall: wing ? wallsWing[f] : wallsMain[f] }
}

const ROOM_ICONS: Record<RoomDef['id'], string> = { living: '🛋️', bedroom: '🛏️', kitchen: '🍳', bath: '🛁', study: '📚' }

/** Sàn ván gỗ: các tấm dài so le, mỗi tấm hơi khác màu (màu theo tầng). */
function plankTexture(style: Style): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 192
  const g = cv.getContext('2d')!
  const rows = 12
  const h = cv.height / rows
  const [dr, dg, db] = style.plank
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -40 : 0
    while (x < cv.width) {
      const len = 70 + ((r * 37 + x) % 50)
      const shade = 150 + ((r * 13 + x) % 25)
      g.fillStyle = `rgb(${shade + dr}, ${shade + dg}, ${shade + db})`
      g.fillRect(x, r * h, len - 2, h - 2)
      x += len
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Thảm phòng phụ: nền màu có đường viền và ô kẻ nhỏ. */
function carpetTexture(style: Style): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  const g = cv.getContext('2d')!
  g.fillStyle = style.carpet[0]
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = style.carpet[1]
  for (let y = 0; y < 128; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < 128; x += 32) g.fillRect(x, y, 16, 16)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 5)
  return tex
}

/** Gạch men ô vuông hai màu xen kẽ. */
function tileTexture(style: Style): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  const g = cv.getContext('2d')!
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? style.tile[1] : style.tile[0]
      g.fillRect(x * 32, y * 32, 32, 32)
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = 2
  for (let i = 0; i <= 4; i++) {
    g.beginPath()
    g.moveTo(i * 32, 0)
    g.lineTo(i * 32, 128)
    g.moveTo(0, i * 32)
    g.lineTo(128, i * 32)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  return tex
}

/** Giấy dán tường: sọc dọc hai tông màu, hoạ tiết chấm nhỏ. */
function wallpaperTexture(style: Style): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 64
  const g = cv.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? style.wall[0] : style.wall[1]
    g.fillRect(i * 16, 0, 16, 64)
  }
  g.fillStyle = 'rgba(100,80,60,0.22)'
  for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 7, 28, 2, 2)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(3, 1)
  return tex
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

/** Đồ cố định của bếp và nhà vệ sinh dựng từ khối đơn giản (tựa vào tường bắc). */
function buildFixture(f: Fixture, x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const mat = (color: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough })
  const box = (w: number, h: number, d: number, color: number, px: number, py: number, pz: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
    m.position.set(px, py, pz)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
    return m
  }
  const cyl = (rt: number, rb: number, h: number, color: number, px: number, py: number, pz: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat(color))
    m.position.set(px, py, pz)
    m.castShadow = true
    g.add(m)
    return m
  }
  const cabinet = (w: number, d: number) => {
    box(w - 0.04, 0.8, d - 0.04, 0xe9e2d0, 0, 0.4, 0)
    box(w, 0.06, d, 0xb9a37e, 0, 0.83, 0)
  }
  switch (f.id) {
    case 'counter':
      cabinet(f.w, f.d)
      break
    case 'sink':
      cabinet(f.w, f.d)
      box(0.55, 0.04, 0.4, 0x6fa3c4, 0, 0.87, 0.02)
      cyl(0.03, 0.03, 0.3, 0xc9ced2, 0, 1.0, -0.25)
      break
    case 'stove':
      cabinet(f.w, f.d)
      box(f.w - 0.1, 0.05, f.d - 0.1, 0x3a3a3f, 0, 0.88, 0)
      for (const [dx, dz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) cyl(0.11, 0.11, 0.03, 0x1d1d20, dx, 0.92, dz)
      break
    case 'fridge':
      box(0.9, 1.9, 0.85, 0xf2f4f5, 0, 0.95, 0)
      box(0.04, 0.5, 0.04, 0x9aa3a8, 0.34, 1.2, 0.45)
      box(0.8, 0.02, 0.02, 0xcfd6d9, 0, 1.45, 0.43)
      break
    case 'toilet':
      cyl(0.26, 0.2, 0.4, 0xf7fbfc, 0, 0.2, 0.1)
      box(0.5, 0.45, 0.2, 0xf7fbfc, 0, 0.62, -0.28)
      cyl(0.24, 0.24, 0.06, 0xdfe9ec, 0, 0.43, 0.1)
      break
    case 'basin':
      cyl(0.12, 0.12, 0.7, 0xf7fbfc, 0, 0.35, -0.1)
      cyl(0.28, 0.2, 0.18, 0xf7fbfc, 0, 0.8, 0)
      cyl(0.03, 0.03, 0.25, 0xc9ced2, 0, 1.0, -0.3)
      break
    case 'tub':
      box(f.w - 0.1, 0.6, f.d - 0.1, 0xf7fbfc, 0, 0.3, 0)
      box(f.w - 0.35, 0.05, f.d - 0.35, 0x8fd0e8, 0, 0.6, 0)
      cyl(0.04, 0.04, 0.3, 0xc9ced2, 0, 0.75, -(f.d / 2) + 0.15)
      break
  }
  g.position.set(x, 0, z)
  return g
}
