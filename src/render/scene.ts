import * as THREE from 'three'
import {
  BUSHES, FARM_HALF, GATE, GROUND_HALF, HOUSE, PATHS, POND, ROCKS, STALL, TREES, TUFTS, type Decor,
} from '../core/world.ts'
import type { Models } from './assets.ts'
import { instanceModel, placeMatrix } from './instancing.ts'

export interface World {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** Gọi mỗi khung hình để vùng bóng đổ đi theo nhân vật. */
  followShadow(target: THREE.Vector3): void
}

// Bảng màu và ánh sáng lấy theo bản cũ.
const SKY = 0xa9dcf2
const GRASS_A = '#93d45a'
const GRASS_B = '#89cc51'
const GRASS_OUTSIDE = 0x7fbf4a
const DIRT_EDGE = 0xc79a5e
const PATH = 0xe3bd82
const SHADOW_SPAN = 18

const flat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 })

export function createWorld(container: HTMLElement, models: Models): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.append(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)
  scene.fog = new THREE.Fog(SKY, 38, 75)

  scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x7c9a4c, 1.7))
  // Một đèn định hướng duy nhất (GDD mục 5.3).
  const sun = new THREE.DirectionalLight(0xffe6bf, 2.6)
  sun.castShadow = true
  // Điện thoại: bản đồ bóng nhỏ hơn cho nhẹ (GDD mục 5.3).
  const shadowSize = matchMedia('(pointer: coarse)').matches ? 1024 : 2048
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_SPAN, right: SHADOW_SPAN, top: SHADOW_SPAN, bottom: -SHADOW_SPAN, near: 1, far: 70,
  })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  const sunOffset = new THREE.Vector3(14, 24, 10)
  scene.add(sun, sun.target)

  addGround(scene)
  addPaths(scene)
  addPond(scene)
  addBuildings(scene, models)
  addFence(scene, models)
  addTrees(scene, models)
  addDecor(scene, models)

  return {
    renderer,
    scene,
    followShadow(target) {
      sun.position.copy(target).add(sunOffset)
      sun.target.position.copy(target)
    },
  }
}

/** Cỏ kẻ ô hai tông như bản cũ: mỗi ô 1 m, viền đất quanh hàng rào. */
function addGround(scene: THREE.Scene): void {
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2), flat(GRASS_OUTSIDE))
  outside.rotation.x = -Math.PI / 2
  outside.receiveShadow = true

  // Viền đất là 4 dải quanh cỏ, không nằm chồng dưới cỏ để tránh nhấp nháy ở xa (z-fighting).
  const border = 0.6
  const edgeMat = flat(DIRT_EDGE)
  const edges = [
    [0, -FARM_HALF - border / 2, FARM_HALF * 2 + border * 2, border],
    [0, FARM_HALF + border / 2, FARM_HALF * 2 + border * 2, border],
    [-FARM_HALF - border / 2, 0, border, FARM_HALF * 2],
    [FARM_HALF + border / 2, 0, border, FARM_HALF * 2],
  ].map(([x, z, w, d]) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), edgeMat)
    strip.rotation.x = -Math.PI / 2
    strip.position.set(x, 0.01, z)
    strip.receiveShadow = true
    return strip
  })

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = GRASS_A
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = GRASS_B
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillRect(1, 1, 1, 1)
  const checker = new THREE.CanvasTexture(canvas)
  checker.magFilter = THREE.NearestFilter
  checker.minFilter = THREE.NearestFilter
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping
  checker.repeat.set(FARM_HALF, FARM_HALF)
  checker.colorSpace = THREE.SRGBColorSpace

  const farm = new THREE.Mesh(
    new THREE.PlaneGeometry(FARM_HALF * 2, FARM_HALF * 2),
    new THREE.MeshStandardMaterial({ map: checker, roughness: 1 }),
  )
  farm.rotation.x = -Math.PI / 2
  farm.position.y = 0.01
  farm.receiveShadow = true
  scene.add(outside, farm, ...edges)
}

/** Đường đất bo tròn hai đầu, nối các đoạn trong PATHS. */
function addPaths(scene: THREE.Scene): void {
  const material = new THREE.MeshStandardMaterial({ color: PATH, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })
  for (const { from, to, width } of PATHS) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const shape = roundedRect(length + width, width, width / 2)
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = Math.atan2(-(to[1] - from[1]), to[0] - from[0])
    mesh.position.set((from[0] + to[0]) / 2, 0.02, (from[1] + to[1]) / 2)
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

function addPond(scene: THREE.Scene): void {
  const shore = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.7, 40), flat(0xe8cf98))
  shore.rotation.x = -Math.PI / 2
  shore.position.set(POND.x, 0.025, POND.z)
  shore.receiveShadow = true
  const deep = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 40), new THREE.MeshStandardMaterial({ color: 0x3f9fcf, roughness: 0.15, metalness: 0.1 }))
  deep.rotation.x = -Math.PI / 2
  deep.position.set(POND.x, 0.04, POND.z)
  const shallow = new THREE.Mesh(
    new THREE.RingGeometry(POND.r - 0.9, POND.r, 40),
    new THREE.MeshStandardMaterial({ color: 0x7fd0e8, roughness: 0.2, transparent: true, opacity: 0.85 }),
  )
  shallow.rotation.x = -Math.PI / 2
  shallow.position.set(POND.x, 0.045, POND.z)
  scene.add(shore, deep, shallow)
}

function addBuildings(scene: THREE.Scene, models: Models): void {
  const house = models.house.scene.clone()
  house.position.set(HOUSE.x, 0, HOUSE.z)
  const shop = models.shop.scene.clone()
  shop.position.set(STALL.x, 0, STALL.z)
  scene.add(house, shop)
}

/** Hàng rào gỗ quanh nông trại, chừa cổng ở giữa cạnh phía nam cho đường đất. */
function addFence(scene: THREE.Scene, models: Models): void {
  const panel = 1.16
  const perSide = Math.round((FARM_HALF * 2) / panel)
  const step = (FARM_HALF * 2) / perSide
  const placements: THREE.Matrix4[] = []
  for (let k = 0; k < perSide; k++) {
    const a = -FARM_HALF + (k + 0.5) * step
    // Mô hình tấm rào nằm dọc trục Z; cạnh bắc/nam cần xoay 90 độ.
    placements.push(placeMatrix(a, -FARM_HALF, Math.PI / 2, 1))
    if (Math.abs(a - GATE.x) > GATE.halfWidth) placements.push(placeMatrix(a, FARM_HALF, Math.PI / 2, 1))
    placements.push(placeMatrix(-FARM_HALF, a, 0, 1), placeMatrix(FARM_HALF, a, 0, 1))
  }
  for (const m of placements) m.scale(new THREE.Vector3(1, 1, step / panel))
  const fence = instanceModel(models.fence.scene, placements.length, { shadows: true })
  placements.forEach((m, i) => fence.setMatrixAt(i, m))
  fence.setCount(placements.length)
  fence.commit()
  scene.add(fence.group)
}

/** Cây trong nông trại dùng mô hình chi tiết; rừng bên ngoài dùng bản nhẹ (lo). */
function addTrees(scene: THREE.Scene, models: Models): void {
  const inside = TREES.filter((t) => Math.abs(t.x) < FARM_HALF && Math.abs(t.z) < FARM_HALF)
  const outside = TREES.filter((t) => !inside.includes(t))
  placeVariants(scene, inside, [models.treeGreen.scene, models.treeSpring.scene, models.treeBlossom.scene], true)
  placeVariants(scene, outside, [models.treeGreenLo.scene, models.treeSpringLo.scene, models.treePine.scene], false)
}

function placeVariants(scene: THREE.Scene, items: { x: number; z: number; rotY: number; scale: number; variant: number }[], sources: THREE.Object3D[], shadows: boolean): void {
  sources.forEach((source, v) => {
    const mine = items.filter((t) => Math.min(sources.length - 1, Math.floor(t.variant * sources.length)) === v)
    if (mine.length === 0) return
    const inst = instanceModel(source, mine.length, { shadows })
    mine.forEach((t, i) => inst.setMatrixAt(i, placeMatrix(t.x, t.z, t.rotY, t.scale)))
    inst.setCount(mine.length)
    inst.commit()
    scene.add(inst.group)
  })
}

function addDecor(scene: THREE.Scene, models: Models): void {
  const place = (source: THREE.Object3D, items: Decor[], shadows: boolean) => {
    const inst = instanceModel(source, items.length, { shadows })
    items.forEach((d, i) => inst.setMatrixAt(i, placeMatrix(d.x, d.z, d.rotY, d.scale)))
    inst.setCount(items.length)
    inst.commit()
    scene.add(inst.group)
  }
  const half = Math.ceil(BUSHES.length / 2)
  place(models.bush.scene, BUSHES.slice(0, half), true)
  place(models.bushFlower.scene, BUSHES.slice(half), true)
  place(models.debris.scene.getObjectByName('Deb_boulder_0') ?? models.debris.scene, ROCKS, true)
  place(models.grass.scene, TUFTS, false)
}
