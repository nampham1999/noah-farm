import { bus } from '../core/events.ts'
import * as THREE from 'three'
import { mulberry32 } from '../core/random.ts'
import type { ClockState, Season } from '../core/state.ts'
import {
  BUSHES, FARM_HALF, FIELD_FENCE, FLOWERS, GATE, GROUND_HALF, HOUSE, PATHS, PROPS, ROCKS, STALL, TREES, TUFTS, type Decor,
} from '../core/world.ts'
import { loadHouseModel, type Models } from './assets.ts'
import { instanceModel, placeMatrix, staticModel } from './instancing.ts'
import { createPond } from './water.ts'
import { applyWind, windify, windUniforms } from './wind.ts'

export interface World {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** Gọi mỗi khung hình: bóng đổ theo nhân vật, ánh sáng theo giờ, cảnh theo mùa, gió, mặt nước. */
  update(time: number, player: THREE.Vector3, clock: ClockState, indoors: boolean): void
  /** Khoảng cách camera tới nhân vật (m), để đẩy sương mù ra xa khi zoom ra. */
  setViewDistance(dist: number): void
  /** Bật/tắt bóng đổ theo bậc chất lượng tự chỉnh. */
  setShadows(on: boolean): void
  /** Đổi mô hình nhà theo cấp (1..5). */
  setHouseLevel(level: number): void
  /** Tiết kiệm pin: tắt bóng đổ, ẩn cỏ và hoa dại. */
  setLowPower(on: boolean): void
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
/** Khoảng cách camera ở zoom 1 trên màn ngang (sương mù đặt theo mức này). */
const BASE_VIEW_DISTANCE = 14.85

const flat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 })

export function createWorld(container: HTMLElement, models: Models): World {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    // ?capture: giữ khung hình đã vẽ để chụp từng khung khi quay video quảng bá.
    preserveDrawingBuffer: /[?&]capture\b/.test(location.search),
  })
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
  const buildings = addBuildings(scene, models)
  addFence(scene, models)
  addFieldFence(scene, models)
  const trees = addTrees(scene, models)
  const decor = addDecor(scene, models)
  const snow = createSnow()
  const rain = createRain()
  scene.add(snow.points, rain.lines)
  // Độ "ướt" của trời (0 nắng .. 1 mưa, 1.4 giông), đổi dần cho mượt; chớp khi giông.
  let gloom = 0
  let lastTime = 0
  let nextFlash = 0
  let flashAt = -10

  let season: Season | null = null
  // Bóng đổ: tắt khi tiết kiệm pin, hoặc khi máy yếu (bậc chất lượng thấp).
  let lowPower = false
  // Camera lùi xa (zoom ra, màn dọc) thì sương mù lùi theo, để nông trại không bị mờ.
  let fogScale = 1
  let autoShadows = true
  const sky = new THREE.Color()
  const sunDir = new THREE.Vector3()

  return {
    renderer,
    scene,
    setHouseLevel(level) {
      buildings.setHouseLevel(level)
    },
    setLowPower(on) {
      lowPower = on
      sun.castShadow = autoShadows && !lowPower
      decor.setLowPower(on)
    },
    setViewDistance(dist) {
      fogScale = Math.max(1, dist / BASE_VIEW_DISTANCE)
    },
    setShadows(on) {
      autoShadows = on
      sun.castShadow = autoShadows && !lowPower
    },
    update(time, player, clock, indoors) {
      if (clock.season !== season) {
        season = clock.season
        ground.setSeason(season)
        trees.setSeason(season)
        decor.setSeason(season)
      }
      const dt = Math.min(0.1, Math.max(0, time - lastTime))
      lastTime = time
      const weather = clock.weather
      const wet = weather === 'rain' || weather === 'storm'
      const targetGloom = weather === 'storm' ? 1.4 : weather === 'rain' ? 1 : weather === 'snow' ? 0.5 : 0
      gloom += (targetGloom - gloom) * Math.min(1, dt * 0.8)
      // Giông: chớp loé sáng vài giây một lần, sấm vang sau đó.
      if (weather === 'storm' && !indoors && time > nextFlash) {
        if (nextFlash > 0) {
          flashAt = time
          setTimeout(() => bus.emit('sfx', 'thunder'), 500 + Math.random() * 900)
        }
        nextFlash = time + 5 + Math.random() * 9
      }
      const flash = Math.max(0, 1 - (time - flashAt) / 0.25)

      // Ánh sáng theo giờ: mặt trời đi từ đông sang tây, đêm chuyển sang ánh trăng xanh.
      // Trong nhà: nền gỗ tối, ánh sáng ấm, không sương mù.
      const light = indoors ? INDOOR_LIGHT : lightAt(clock.minuteOfDay)
      ;(scene.fog as THREE.Fog).far = indoors ? 1000 : 75 * fogScale
      sky.copy(light.sky)
      ;(scene.background as THREE.Color).copy(sky)
      ;(scene.fog as THREE.Fog).color.copy(sky)
      sun.color.copy(light.sun)
      sun.intensity = light.sunI
      hemi.intensity = light.hemiI
      hemi.color.copy(light.hemi)
      if (!indoors && gloom > 0.01) {
        // Trời mưa: nắng yếu, bầu trời xám, sương mù gần hơn.
        const g = Math.min(1, gloom)
        sun.intensity *= 1 - 0.6 * g
        hemi.intensity *= 1 - 0.2 * g
        sky.lerp(cb.setHex(RAIN_SKY).multiplyScalar(Math.min(1, 0.35 + light.sunI / 2.6)), 0.6 * g)
        ;(scene.background as THREE.Color).copy(sky)
        ;(scene.fog as THREE.Fog).color.copy(sky)
        ;(scene.fog as THREE.Fog).near = (38 - 16 * gloom) * fogScale
        ;(scene.fog as THREE.Fog).far = (75 - 22 * gloom) * fogScale
      } else if (!indoors) {
        ;(scene.fog as THREE.Fog).near = 38 * fogScale
      }
      if (flash > 0) {
        hemi.intensity += 3 * flash
        ;(scene.background as THREE.Color).lerp(ca.setHex(0xe8eeff), 0.6 * flash)
      }
      const arc = ((clock.minuteOfDay / 1440) * 2 - 0.5) * Math.PI
      sunDir.set(Math.sin(arc) * 16, 24, 10)
      sun.position.copy(player).add(sunDir)
      sun.target.position.copy(player)

      windUniforms.uTime.value = time
      windUniforms.uPlayer.value.set(player.x, player.z)
      pond.update(time)
      snow.points.visible = weather === 'snow' && !indoors
      if (snow.points.visible) snow.update(time, player)
      rain.lines.visible = wet && !indoors
      if (rain.lines.visible) rain.update(time, player, weather === 'storm')
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

/** Màu trời khi mưa (giữa trưa); buổi tối thì tối theo. */
const RAIN_SKY = 0x8794a6

/** Mưa: các vệt nước rơi xiên quanh nhân vật; giông thì rơi nhanh và xiên hơn. */
function createRain(): { lines: THREE.LineSegments; update(time: number, player: THREE.Vector3, storm: boolean): void } {
  const count = 900
  const span = 30
  const height = 14
  const seeds = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = (Math.random() - 0.5) * span
    seeds[i * 3 + 1] = Math.random() * height
    seeds[i * 3 + 2] = (Math.random() - 0.5) * span
  }
  const pos = new Float32Array(count * 6)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0.55, depthWrite: false }))
  lines.frustumCulled = false
  lines.visible = false
  return {
    lines,
    update(time, player, storm) {
      const speed = storm ? 20 : 14
      const slant = storm ? 0.35 : 0.12
      const len = storm ? 0.8 : 0.55
      for (let i = 0; i < count; i++) {
        let y = (seeds[i * 3 + 1] - time * speed) % height
        if (y < 0) y += height
        const x = player.x + seeds[i * 3] + y * slant
        const z = player.z + seeds[i * 3 + 2]
        const k = i * 6
        pos[k] = x
        pos[k + 1] = y
        pos[k + 2] = z
        pos[k + 3] = x - len * slant
        pos[k + 4] = y + len
        pos[k + 5] = z
      }
      geo.attributes.position.needsUpdate = true
    },
  }
}

/** Tuyết rơi quanh nhân vật vào ngày tuyết. */
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
  // Cỏ tự nhiên: một ô texture lặp liền mạch (mảng loang, ngọn cỏ), nhân với màu theo đỉnh
  // biến thiên chậm trên cả sân để không thấy họa tiết lặp lại.
  const grass = createGrassTexture()
  grass.texture.repeat.set((FARM_HALF * 2) / GRASS_TILE, (FARM_HALF * 2) / GRASS_TILE)
  const outsideTex = grass.texture.clone()
  outsideTex.repeat.set((GROUND_HALF * 2) / GRASS_TILE, (GROUND_HALF * 2) / GRASS_TILE)

  const outsideMat = new THREE.MeshStandardMaterial({ map: outsideTex, roughness: 1, color: 0xd8e6cc })
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

  const geo = new THREE.PlaneGeometry(FARM_HALF * 2, FARM_HALF * 2, 48, 48)
  geo.setAttribute('color', new THREE.Float32BufferAttribute(macroTint(geo), 3))
  const farm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grass.texture, vertexColors: true, roughness: 1 }))
  farm.rotation.x = -Math.PI / 2
  farm.position.y = 0.01
  farm.receiveShadow = true
  scene.add(outside, farm, ...edges)

  return {
    setSeason(season) {
      const g = GRASS[season]
      grass.paint(g.a, g.b, season === 'winter')
      outsideTex.needsUpdate = true
      outsideMat.color.setHex(g.outside).lerp(new THREE.Color(0xffffff), 0.35)
    },
  }
}

/** Một ô texture cỏ phủ chừng này mét. */
const GRASS_TILE = 6

/** Texture cỏ vẽ bằng canvas, lặp liền mạch; paint() vẽ lại theo màu mùa. */
function createGrassTexture(): { texture: THREE.CanvasTexture; paint(base: string, alt: string, snowy: boolean): void } {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  // Vẽ một hình ở (x, y) và cả các bản bù mép, để ô texture lặp không lộ đường nối.
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const px = x + dx
        const py = y + dy
        if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue
        draw(px, py)
      }
    }
  }

  return {
    texture,
    paint(base, alt, snowy) {
      const rand = mulberry32(1234)
      // Tuyết: mảng loang nhạt, chỉ lấm tấm vài ngọn cỏ.
      const blades = snowy ? 900 : 5200
      const contrast = snowy ? 0.5 : 1
      const light = new THREE.Color(base).offsetHSL(0.01, 0.02, 0.07).getStyle()
      const dark = new THREE.Color(alt).offsetHSL(-0.01, 0.04, -0.09).getStyle()
      ctx.fillStyle = base
      ctx.fillRect(0, 0, size, size)
      // Mảng loang mềm, lớn nhỏ xen kẽ.
      for (let i = 0; i < 70; i++) {
        const x = rand() * size
        const y = rand() * size
        const r = 30 + rand() * 90
        const color = rand() < 0.5 ? dark : light
        wrapped(x, y, r, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r)
          g.addColorStop(0, color)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.globalAlpha = (0.18 + rand() * 0.14) * contrast
          ctx.fillStyle = g
          ctx.fillRect(px - r, py - r, r * 2, r * 2)
        })
      }
      // Ngọn cỏ ngắn: nét mảnh hơi nghiêng, sáng tối xen kẽ.
      ctx.lineCap = 'round'
      for (let i = 0; i < blades; i++) {
        const x = rand() * size
        const y = rand() * size
        const len = 3 + rand() * 6
        const ang = -Math.PI / 2 + (rand() - 0.5) * 0.9
        const r = rand()
        ctx.strokeStyle = r < 0.45 ? dark : r < 0.9 ? light : alt
        ctx.globalAlpha = (0.35 + rand() * 0.35) * contrast
        ctx.lineWidth = 1 + rand() * 1.2
        wrapped(x, y, len, (px, py) => {
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len)
          ctx.stroke()
        })
      }
      ctx.globalAlpha = 1
      texture.needsUpdate = true
    },
  }
}

/** Màu theo đỉnh biến thiên chậm (hai lớp sóng) để sân cỏ chỗ đậm chỗ nhạt tự nhiên. */
function macroTint(geo: THREE.PlaneGeometry): number[] {
  const pos = geo.attributes.position
  const out: number[] = []
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const n =
      Math.sin(x * 0.21 + 1.3) * Math.cos(y * 0.17 - 0.7) * 0.5 +
      Math.sin(x * 0.07 - y * 0.09 + 2.1) * 0.35 +
      Math.sin((x + y) * 0.43) * 0.15
    const v = 0.92 + n * 0.09
    // Chỗ sáng hơi ngả vàng, chỗ tối hơi xanh lục đậm.
    out.push(v * (1 + n * 0.03), v, v * (1 - n * 0.04))
  }
  return out
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

function addBuildings(scene: THREE.Scene, models: Models): { setHouseLevel(level: number): void } {
  let house = staticModel(models.house.scene)
  house.position.set(HOUSE.x, 0, HOUSE.z)
  const shop = staticModel(models.shop.scene)
  shop.position.set(STALL.x, 0, STALL.z)
  scene.add(house, shop)
  let shown = 1
  return {
    setHouseLevel(level) {
      if (level === shown) return
      shown = level
      const swap = (source: THREE.Object3D) => {
        if (shown !== level) return
        scene.remove(house)
        house = staticModel(source)
        house.position.set(HOUSE.x, 0, HOUSE.z)
        scene.add(house)
      }
      if (level <= 1) swap(models.house.scene)
      else void loadHouseModel(level).then((g) => swap(g.scene))
    },
  }
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
    if (Math.abs(a - GATE.x) > GATE.halfWidth) placements.push(placeMatrix(a, -FARM_HALF, Math.PI / 2, 1))
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

/** Rào quanh khu ruộng: dựng tấm rào dọc theo từng đoạn trong FIELD_FENCE, chừa cổng. */
function addFieldFence(scene: THREE.Scene, models: Models): void {
  const panel = 1.19
  const placements: THREE.Matrix4[] = []
  for (const { from, to } of FIELD_FENCE) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1])
    const n = Math.max(1, Math.round(len / panel))
    const step = len / n
    // Mô hình tấm rào nằm dọc trục Z; đoạn chạy theo trục X thì xoay 90 độ.
    const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1])
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const m = placeMatrix(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, alongX ? Math.PI / 2 : 0, 1)
      placements.push(m.scale(new THREE.Vector3(1, 1, step / panel)))
    }
  }
  const fence = instanceModel(models.fieldFence.scene, placements.length, { shadows: true })
  placements.forEach((m, i) => fence.setMatrixAt(i, m))
  fence.setCount(placements.length)
  fence.commit()
  scene.add(fence.group)
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

function addDecor(scene: THREE.Scene, models: Models): { setSeason(season: Season): void; setLowPower(on: boolean): void } {
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

  let winter = false
  let lowPower = false
  // Mùa đông tuyết phủ, hoặc đang tiết kiệm pin: không vẽ hoa dại và cỏ ngọn.
  const applyVisibility = () => {
    flowers.visible = tufts.visible = !winter && !lowPower
  }
  return {
    setSeason(season) {
      bushes.setSeason(season)
      winter = season === 'winter'
      applyVisibility()
    },
    setLowPower(on) {
      lowPower = on
      applyVisibility()
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
