import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState } from '../core/state.ts'
import { MAIN_W, ROOM, roomCorner, STAIRS_DOWN, STAIRS_UP } from '../core/world.ts'
import { canPlace, floorCount, footprint, furnitureCenter, furnitureDef, partitionRects } from '../systems/house.ts'
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
  // Vỏ phòng dựng theo bố cục nhà và tầng đang đứng: phòng chính, phòng phụ (nếu có) ngăn bằng vách, cầu thang.
  let grid = new THREE.Mesh()
  let builtKey = ''
  const buildShell = (floor: number, floors: number) => {
    room.clear()
    builtKey = `${ROOM.w}x${ROOM.d}|${floor}|${floors}`
    const c = roomCorner()
    const wingW = ROOM.w - MAIN_W
    const mainStyle = styleOf(floor, false)
    const wingStyle = styleOf(floor, true)
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })

    // Sàn: phòng chính lát ván gỗ, phòng phụ trải thảm (mỗi tầng một tông màu).
    const mkFloor = (x0: number, w: number, tex: THREE.Texture) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
      f.rotation.x = -Math.PI / 2
      f.position.set(c.x + x0 + w / 2, 0.02, ROOM.z)
      f.receiveShadow = true
      return f
    }
    room.add(mkFloor(0, wingW > 0 ? MAIN_W : ROOM.w, plankTexture(mainStyle)))
    if (wingW > 0) room.add(mkFloor(MAIN_W, wingW, carpetTexture(wingStyle)))

    grid = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.w, ROOM.d),
      new THREE.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false }),
    )
    grid.rotation.x = -Math.PI / 2
    grid.position.set(ROOM.x, 0.03, ROOM.z)
    room.add(grid)

    // Tường bắc và hai tường bên (giấy dán mỗi phòng một kiểu).
    const mkWall = (w: number, h: number, d: number, x: number, z: number, style: Style) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: wallpaperTexture(style), roughness: 1 }))
      wall.position.set(x, h / 2, z)
      wall.receiveShadow = true
      room.add(wall)
      return wall
    }
    const mainSpan = wingW > 0 ? MAIN_W : ROOM.w
    mkWall(mainSpan + 0.2, WALL_H, 0.2, c.x + mainSpan / 2 - 0.1, c.z - 0.1, mainStyle)
    if (wingW > 0) mkWall(wingW + 0.2, WALL_H, 0.2, c.x + MAIN_W + wingW / 2 + 0.1, c.z - 0.1, wingStyle)
    mkWall(0.2, WALL_H, ROOM.d, c.x - 0.1, ROOM.z, mainStyle)
    mkWall(0.2, WALL_H, ROOM.d, c.x + ROOM.w + 0.1, ROOM.z, wingW > 0 ? wingStyle : mainStyle)
    const base = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.4, 0.18, 0.24), trimMat)
    base.position.set(ROOM.x, 0.09, c.z - 0.08)
    room.add(base)

    // Vách ngăn phòng chính / phòng phụ: hai đoạn tường, thêm xà ngang trên lối đi và hai cột khung cửa.
    for (const r of partitionRects()) {
      const seg = mkWall(0.2, WALL_H, r.z1 - r.z0, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, mainStyle)
      void seg
    }
    if (wingW > 0) {
      const parts = partitionRects()
      const gapZ0 = parts[0].z1
      const gapZ1 = parts[1].z0
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, gapZ1 - gapZ0 + 0.2), trimMat)
      lintel.position.set(c.x + MAIN_W, WALL_H - 0.25, (gapZ0 + gapZ1) / 2)
      room.add(lintel)
      for (const z of [gapZ0, gapZ1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, WALL_H, 0.12), trimMat)
        post.position.set(c.x + MAIN_W, WALL_H / 2, z)
        room.add(post)
      }
    }

    // Cửa sổ trên tường bắc: hai cái ở phòng chính, một cái ở phòng phụ.
    if (windowModel) {
      const xs = wingW > 0 ? [c.x + MAIN_W * 0.25, c.x + MAIN_W * 0.7, c.x + MAIN_W + wingW / 2] : [c.x + ROOM.w * 0.25, c.x + ROOM.w * 0.75]
      for (const x of xs) {
        const win = windowModel.clone()
        win.position.set(x, 1.0, c.z + 0.05)
        room.add(win)
      }
    }

    // Thảm cửa (chỉ tầng trệt, giữa cạnh nam của phòng chính).
    if (floor === 0) {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 1 }))
      mat.rotation.x = -Math.PI / 2
      mat.position.set(c.x + MAIN_W / 2, 0.035, c.z + ROOM.d - 0.35)
      room.add(mat)
    }

    // Cầu thang: lên (nếu còn tầng trên) và xuống (nếu không phải tầng trệt), kèm biển chỉ tầng.
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
    if (floor + 1 < floors) addStairs(STAIRS_UP, true, floor + 2)
    if (floor > 0) addStairs(STAIRS_DOWN, false, floor)

    // Đèn ấm cho từng phòng.
    const addLamp = (x: number, span: number) => {
      const lamp = new THREE.PointLight(floor === 2 ? 0xffe2b0 : 0xffd6a0, 6, Math.max(span, ROOM.d) * 1.5, 1.6)
      lamp.position.set(x, 2.4, ROOM.z)
      room.add(lamp)
    }
    addLamp(c.x + mainSpan / 2, mainSpan)
    if (wingW > 0) addLamp(c.x + MAIN_W + wingW / 2, wingW)
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
      const shellKey = `${ROOM.w}x${ROOM.d}|${state.player.floor}|${floorCount(state)}`
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

/** Bảng màu mỗi phòng: sàn, thảm, giấy dán tường (khác nhau theo tầng và theo phòng chính / phòng phụ). */
interface Style {
  plank: [number, number, number]
  carpet: [string, string]
  wall: [string, string]
}

function styleOf(floor: number, wing: boolean): Style {
  const wallsMain: [string, string][] = [['#f6e3c8', '#efd2c0'], ['#e6efd9', '#d6e5c4'], ['#eadcc0', '#d9c4a0']]
  const wallsWing: [string, string][] = [['#dfe8f4', '#cddcee'], ['#f3e0ee', '#e8cde1'], ['#d9d3ea', '#c7bfe0']]
  const planks: [number, number, number][] = [[15, -30, -75], [42, 8, -38], [4, -12, -34]]
  const carpets: [string, string][] = [['#9a5a56', '#8c4e4b'], ['#5f9ea0', '#518f91'], ['#7f6aa5', '#715d96']]
  const f = Math.min(floor, 2)
  return { plank: planks[f], carpet: carpets[f], wall: wing ? wallsWing[f] : wallsMain[f] }
}

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
