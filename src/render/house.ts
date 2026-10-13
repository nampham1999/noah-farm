import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState } from '../core/state.ts'
import { ROOM, roomCorner } from '../core/world.ts'
import { canPlace, footprint, furnitureCenter, furnitureDef } from '../systems/house.ts'

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
  const c = roomCorner()

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(ROOM.x, 0.02, ROOM.z)
  floor.receiveShadow = true

  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false }),
  )
  grid.rotation.x = -Math.PI / 2
  grid.position.set(ROOM.x, 0.03, ROOM.z)

  const wallMat = new THREE.MeshStandardMaterial({ map: wallpaperTexture(), roughness: 1 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const north = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.4, WALL_H, 0.2), wallMat)
  north.position.set(ROOM.x, WALL_H / 2, c.z - 0.1)
  const west = new THREE.Mesh(new THREE.BoxGeometry(0.2, WALL_H, ROOM.d), wallMat)
  west.position.set(c.x - 0.1, WALL_H / 2, ROOM.z)
  const east = west.clone()
  east.position.x = c.x + ROOM.w + 0.1
  // Chân tường và nẹp gỗ.
  const base = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.4, 0.18, 0.24), trimMat)
  base.position.set(ROOM.x, 0.09, c.z - 0.08)
  for (const w of [north, west, east]) w.receiveShadow = true
  room.add(floor, grid, north, west, east, base)

  if (windowModel) {
    for (const dx of [-2, 2]) {
      const win = windowModel.clone()
      win.position.set(ROOM.x + dx, 1.0, c.z + 0.05)
      room.add(win)
    }
  }

  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 1 }))
  mat.rotation.x = -Math.PI / 2
  mat.position.set(ROOM.x, 0.035, c.z + ROOM.d - 0.35)
  room.add(mat)

  const lamp = new THREE.PointLight(0xffd6a0, 6, 10, 1.6)
  lamp.position.set(ROOM.x, 2.4, ROOM.z)
  room.add(lamp)
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
      const indoors = state.player.indoors
      room.visible = placed.visible = indoors
      grid.visible = indoors && decorating

      const sig = JSON.stringify(state.house.furniture)
      if (sig !== signature) {
        signature = sig
        placed.clear()
        for (const f of state.house.furniture) {
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

/** Sàn ván gỗ: các tấm dài so le, mỗi tấm hơi khác màu. */
function plankTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 192
  const g = cv.getContext('2d')!
  const rows = 12
  const h = cv.height / rows
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -40 : 0
    while (x < cv.width) {
      const len = 70 + ((r * 37 + x) % 50)
      const shade = 150 + ((r * 13 + x) % 25)
      g.fillStyle = `rgb(${shade + 15}, ${shade - 30}, ${shade - 75})`
      g.fillRect(x, r * h, len - 2, h - 2)
      x += len
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Giấy dán tường: sọc dọc kem và hồng nhạt, hoạ tiết chấm nhỏ. */
function wallpaperTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 64
  const g = cv.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f6e3c8' : '#efd2c0'
    g.fillRect(i * 16, 0, 16, 64)
  }
  g.fillStyle = 'rgba(176,110,51,0.25)'
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
