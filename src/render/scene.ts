import * as THREE from 'three'
import type { ClockState, Season } from '../core/state.ts'
import {
  BUSHES, FARM_HALF, FLOWERS, GATE, GROUND_HALF, HOUSE, PATHS, PROPS, ROCKS, STALL, TREES, TUFTS, type Decor,
} from '../core/world.ts'
import type { Models } from './assets.ts'
import { instanceModel, placeMatrix } from './instancing.ts'
import { createPond } from './water.ts'
import { applyWind, windify, windUniforms } from './wind.ts'

export interface World {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** Gọi mỗi khung hình: bóng đổ theo nhân vật, ánh sáng theo giờ, cảnh theo mùa, gió, mặt nước. */
  update(time: number, player: THREE.Vector3, clock: ClockState, indoors: boolean): void
}

// Bảng màu lấy theo bản cũ; cỏ đổi màu theo mùa (GDD mục 3.2).
const SKY = 0xa9dcf2
const GRASS: Record<Season, { a: string; b: string; outside: number }> = {
  spring: { a: '#93d45a', b: '#89cc51', outside: 0x7fbf4a },
  summer: { a: '#86cf47', b: '#7bc43f', outside: 0x6fb53c },
  autumn: { a: '#c8bf58', b: '#bcb24d', outside: 0xb0a048 },
  winter: { a: '#eef4f7', b: '#e2ebf0', outside: 0xdfe8ee },
}
const DIRT_EDGE = 0xc79a5e
const PATH = 0xe3bd82
const SHADOW_SPAN = 18

const flat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 })

export function createWorld(container: HTMLElement, models: Models): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.append(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)
  scene.fog = new THREE.Fog(SKY, 38, 75)

  const hemi = new THREE.HemisphereLight(0xe6f4ff, 0x7c9a4c, 1.7)
  scene.add(hemi)
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
  scene.add(sun, sun.target)

  const ground = addGround(scene)
  addPaths(scene)
  const pond = createPond(scene, models)
  addBuildings(scene, models)
  addFence(scene, models)
  const trees = addTrees(scene, models)
  const decor = addDecor(scene, models)
  const snow = createSnow()
  scene.add(snow.points)

  let season: Season | null = null
  const sky = new THREE.Color()
  const sunDir = new THREE.Vector3()

  return {
    renderer,
    scene,
    update(time, player, clock, indoors) {
      if (clock.season !== season) {
        season = clock.season
        ground.setSeason(season)
        trees.setSeason(season)
        decor.setSeason(season)
        snow.points.visible = season === 'winter'
      }

      // Ánh sáng theo giờ: mặt trời đi từ đông sang tây, đêm chuyển sang ánh trăng xanh.
      // Trong nhà: nền gỗ tối, ánh sáng ấm, không sương mù.
      const light = indoors ? INDOOR_LIGHT : lightAt(clock.minuteOfDay)
      ;(scene.fog as THREE.Fog).far = indoors ? 1000 : 75
      sky.copy(light.sky)
      ;(scene.background as THREE.Color).copy(sky)
      ;(scene.fog as THREE.Fog).color.copy(sky)
      sun.color.copy(light.sun)
      sun.intensity = light.sunI
      hemi.intensity = light.hemiI
      hemi.color.copy(light.hemi)
      const arc = ((clock.minuteOfDay / 1440) * 2 - 0.5) * Math.PI
      sunDir.set(Math.sin(arc) * 16, 24, 10)
      sun.position.copy(player).add(sunDir)
      sun.target.position.copy(player)

      windUniforms.uTime.value = time
      windUniforms.uPlayer.value.set(player.x, player.z)
      pond.update(time)
      if (snow.points.visible) snow.update(time, player)
      snow.points.visible = season === 'winter' && !indoors
    },
  }
}

interface LightKey {
  m: number
  sky: number
  sun: number
  sunI: number
  hemi: number
  hemiI: number
}

/** Mốc ánh sáng trong ngày (phút); giữa hai mốc thì nội suy. Đêm vẫn đủ sáng để chơi. */
const LIGHT_KEYS: LightKey[] = [
  { m: 0, sky: 0x24365e, sun: 0x9fb8ff, sunI: 0.7, hemi: 0x8fa6d8, hemiI: 0.9 },
  { m: 300, sky: 0x2c3f6a, sun: 0x9fb8ff, sunI: 0.7, hemi: 0x8fa6d8, hemiI: 0.9 },
  { m: 390, sky: 0xf5b98a, sun: 0xffb27a, sunI: 1.8, hemi: 0xffe0c4, hemiI: 1.3 },
  { m: 480, sky: SKY, sun: 0xffe6bf, sunI: 2.6, hemi: 0xe6f4ff, hemiI: 1.7 },
  { m: 1020, sky: SKY, sun: 0xffe6bf, sunI: 2.6, hemi: 0xe6f4ff, hemiI: 1.7 },
  { m: 1140, sky: 0xf29a74, sun: 0xff9a5c, sunI: 1.7, hemi: 0xffc9a8, hemiI: 1.3 },
  { m: 1230, sky: 0x2c3f6a, sun: 0x9fb8ff, sunI: 0.7, hemi: 0x8fa6d8, hemiI: 0.9 },
  { m: 1440, sky: 0x24365e, sun: 0x9fb8ff, sunI: 0.7, hemi: 0x8fa6d8, hemiI: 0.9 },
]

const INDOOR_LIGHT = {
  sky: new THREE.Color(0x2b1d14),
  sun: new THREE.Color(0xffe2c0),
  hemi: new THREE.Color(0xffe2c0),
  sunI: 1.2,
  hemiI: 1.3,
}

const lightOut = { sky: new THREE.Color(), sun: new THREE.Color(), hemi: new THREE.Color(), sunI: 0, hemiI: 0 }
const ca = new THREE.Color()
const cb = new THREE.Color()

function lightAt(minute: number): typeof lightOut {
  let i = 0
  while (i < LIGHT_KEYS.length - 2 && LIGHT_KEYS[i + 1].m <= minute) i++
  const a = LIGHT_KEYS[i]
  const b = LIGHT_KEYS[i + 1]
  const t = Math.min(1, Math.max(0, (minute - a.m) / (b.m - a.m)))
  lightOut.sky.copy(ca.setHex(a.sky)).lerp(cb.setHex(b.sky), t)
  lightOut.sun.copy(ca.setHex(a.sun)).lerp(cb.setHex(b.sun), t)
  lightOut.hemi.copy(ca.setHex(a.hemi)).lerp(cb.setHex(b.hemi), t)
  lightOut.sunI = a.sunI + (b.sunI - a.sunI) * t
  lightOut.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t
  return lightOut
}

/** Tuyết rơi quanh nhân vật vào mùa đông. */
function createSnow(): { points: THREE.Points; update(time: number, player: THREE.Vector3): void } {
  const count = 1200
  const span = 30
  const base = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    base[i * 3] = (Math.random() - 0.5) * span
    base[i * 3 + 1] = Math.random() * 14
    base[i * 3 + 2] = (Math.random() - 0.5) * span
  }
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(base)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }))
  points.frustumCulled = false
  points.visible = false
  return {
    points,
    update(time, player) {
      for (let i = 0; i < count; i++) {
        const fall = (base[i * 3 + 1] - time * 1.2) % 14
        pos[i * 3] = player.x + base[i * 3] + Math.sin(time * 0.8 + i) * 0.3
        pos[i * 3 + 1] = fall < 0 ? fall + 14 : fall
        pos[i * 3 + 2] = player.z + base[i * 3 + 2]
      }
      geo.attributes.position.needsUpdate = true
    },
  }
}

/** Cỏ kẻ ô hai tông như bản cũ: mỗi ô 1 m, viền đất quanh hàng rào; màu đổi theo mùa. */
function addGround(scene: THREE.Scene): { setSeason(season: Season): void } {
  const outsideMat = flat(GRASS.spring.outside)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2), outsideMat)
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

  return {
    setSeason(season) {
      const g = GRASS[season]
      ctx.fillStyle = g.a
      ctx.fillRect(0, 0, 2, 2)
      ctx.fillStyle = g.b
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillRect(1, 1, 1, 1)
      checker.needsUpdate = true
      outsideMat.color.setHex(g.outside)
    },
  }
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

/** Một nhóm vật thể cho mỗi mùa; đổi mùa thì chỉ bật nhóm của mùa đó. */
function seasonal(scene: THREE.Scene, build: (season: Season, group: THREE.Group) => void): { setSeason(season: Season): void } {
  const groups = Object.fromEntries(
    (['spring', 'summer', 'autumn', 'winter'] as const).map((s) => {
      const g = new THREE.Group()
      g.visible = false
      build(s, g)
      scene.add(g)
      return [s, g]
    }),
  ) as Record<Season, THREE.Group>
  return {
    setSeason(season) {
      for (const [s, g] of Object.entries(groups)) g.visible = s === season
    },
  }
}

/** Cây trong nông trại dùng mô hình chi tiết, rừng bên ngoài dùng bản nhẹ (lo); mỗi mùa một bộ. */
function addTrees(scene: THREE.Scene, models: Models): { setSeason(season: Season): void } {
  const inside = TREES.filter((t) => Math.abs(t.x) < FARM_HALF && Math.abs(t.z) < FARM_HALF)
  const outside = TREES.filter((t) => !inside.includes(t))
  const sets: Record<Season, [THREE.Object3D[], THREE.Object3D[]]> = {
    spring: [[models.treeGreen.scene, models.treeSpring.scene, models.treeBlossom.scene], [models.treeGreenLo.scene, models.treeSpringLo.scene, models.treePine.scene]],
    summer: [[models.treeGreen.scene, models.treeApple.scene, models.treeCitrus.scene], [models.treeGreenLo.scene, models.treeGreenLo.scene, models.treePine.scene]],
    autumn: [[models.treeAutumn.scene, models.treeBirchAutumn.scene, models.treeAutumn.scene], [models.treeAutumnLo.scene, models.treeAutumnLo.scene, models.treePine.scene]],
    winter: [[models.treeWinter.scene, models.treeSnowy.scene, models.treeBirchWinter.scene], [models.treeSnowyLo.scene, models.treeSnowyLo.scene, models.treePineSnow.scene]],
  }
  return seasonal(scene, (season, group) => {
    placeVariants(group, inside, sets[season][0], true)
    placeVariants(group, outside, sets[season][1], false)
  })
}

function placeVariants(parent: THREE.Object3D, items: { x: number; z: number; rotY: number; scale: number; variant: number }[], sources: THREE.Object3D[], shadows: boolean): void {
  sources.forEach((source, v) => {
    const mine = items.filter((t) => Math.min(sources.length - 1, Math.floor(t.variant * sources.length)) === v)
    if (mine.length === 0) return
    const inst = instanceModel(source, mine.length, { shadows })
    mine.forEach((t, i) => inst.setMatrixAt(i, placeMatrix(t.x, t.z, t.rotY, t.scale)))
    inst.setCount(mine.length)
    inst.commit()
    parent.add(inst.group)
  })
}

function addDecor(scene: THREE.Scene, models: Models): { setSeason(season: Season): void } {
  const place = (parent: THREE.Object3D, source: THREE.Object3D, items: Decor[], shadows: boolean) => {
    const inst = instanceModel(source, items.length, { shadows })
    items.forEach((d, i) => inst.setMatrixAt(i, placeMatrix(d.x, d.z, d.rotY, d.scale)))
    inst.setCount(items.length)
    inst.commit()
    parent.add(inst.group)
  }
  const half = Math.ceil(BUSHES.length / 2)
  // Bụi cây: mùa đông phủ tuyết; mùa thu không có hoa.
  const bushes = seasonal(scene, (season, group) => {
    const a = season === 'winter' ? models.bushSnow.scene : models.bush.scene
    const b = season === 'winter' ? models.bushSnow.scene : season === 'autumn' ? models.bush.scene : models.bushFlower.scene
    place(group, a, BUSHES.slice(0, half), true)
    place(group, b, BUSHES.slice(half), true)
  })
  place(scene, models.debris.scene.getObjectByName('Deb_boulder_0') ?? models.debris.scene, ROCKS, true)
  // Cỏ lay theo gió và rẽ ra khi nhân vật đi qua, như bản cũ.
  const tufts = new THREE.Group()
  place(tufts, windify(models.grass.scene.clone(), { strength: 0.09, heightScale: 3, push: 0.3 }), TUFTS, false)
  scene.add(tufts)
  const flowers = addFlowers(scene)

  // Đồ vật KayKit (giếng, thùng, bao tải...) rất nhỏ nên phóng lên 3,5 lần.
  for (const prop of PROPS) {
    const obj = models[prop.model].scene.clone()
    obj.position.set(prop.x, 0, prop.z)
    obj.rotation.y = prop.rotY
    obj.scale.setScalar(3.5)
    scene.add(obj)
  }

  return {
    setSeason(season) {
      bushes.setSeason(season)
      // Mùa đông tuyết phủ: không còn hoa dại và cỏ ngọn.
      flowers.visible = season !== 'winter'
      tufts.visible = season !== 'winter'
    },
  }
}

/** Hoa dại nhỏ: cuống xanh và bông nhiều màu, lay theo gió. */
function addFlowers(scene: THREE.Scene): THREE.Group {
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.22, 4)
  stemGeo.translate(0, 0.11, 0)
  const headGeo = new THREE.IcosahedronGeometry(0.065, 0)
  headGeo.scale(1, 0.6, 1)
  headGeo.translate(0, 0.24, 0)
  const centerGeo = new THREE.SphereGeometry(0.03, 6, 4)
  centerGeo.translate(0, 0.27, 0)
  const wind = { strength: 0.05, heightScale: 4, push: 0.2 }
  const make = (geo: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(geo, applyWind(material, wind), FLOWERS.length)
    mesh.frustumCulled = false
    return mesh
  }
  const stems = make(stemGeo, new THREE.MeshStandardMaterial({ color: 0x4f9a3a, roughness: 1 }))
  const heads = make(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }))
  const centers = make(centerGeo, new THREE.MeshStandardMaterial({ color: 0xffd23b, roughness: 0.9 }))
  const palette = [0xffffff, 0xff8fb1, 0xffd34d, 0xb68cff, 0xff6f61, 0x8fd3ff].map((c) => new THREE.Color(c))
  const m = new THREE.Matrix4()
  FLOWERS.forEach((f, i) => {
    placeMatrix(f.x, f.z, f.rotY, f.scale * 1.4, 0, m)
    stems.setMatrixAt(i, m)
    heads.setMatrixAt(i, m)
    centers.setMatrixAt(i, m)
    heads.setColorAt(i, palette[i % palette.length])
  })
  const group = new THREE.Group()
  group.add(stems, heads, centers)
  scene.add(group)
  return group
}
