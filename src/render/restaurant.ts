import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RESTAURANT, RESTAURANT_TABLES } from '../core/world.ts'
import { createSign } from './animals.ts'

export interface RestaurantView {
  update(state: GameState): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

const mat = (color: number, roughness = 0.95) => new THREE.MeshStandardMaterial({ color, roughness })
const CLOTHS = [0xd9483b, 0x3f7fc4, 0x4f9a54, 0xe6b43a]

/** Nhà hàng ngoài phố: nhà gỗ mái đỏ có mái hiên sọc, sân trước có bốn bàn (mỗi cấp mở một bàn hai ghế). */
export function createRestaurantView(scene: THREE.Scene): RestaurantView {
  const root = new THREE.Group()
  const { w, d } = RESTAURANT
  const wall = mat(0xf0e2c0)
  const wood = mat(0x7a4a22)
  const stone = mat(0xb9b2a4)

  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.25, d + 0.5), stone)
  base.position.y = 0.12
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wall)
  body.position.y = 1.75
  root.add(base, body)
  // Khung gỗ: cột ở bốn góc và hai cột hai bên cửa.
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [-1.1, d / 2], [1.1, d / 2], [-3.2, d / 2], [3.2, d / 2]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.1, 0.22), wood)
    post.position.set(x, 1.75, z)
    root.add(post)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.2, 0.2), wood)
  beam.position.set(0, 3.2, d / 2)
  root.add(beam)

  // Mái hai dốc (lăng trụ tam giác) dọc theo chiều rộng, cùng một ống khói.
  const roofMat = mat(0xb5392b, 0.85)
  const half = d / 2 + 0.8
  const profile = new THREE.Shape()
  profile.moveTo(-half, 0)
  profile.lineTo(half, 0)
  profile.lineTo(0, 2.1)
  profile.closePath()
  const roofGeo = new THREE.ExtrudeGeometry(profile, { depth: w + 1.2, bevelEnabled: false })
  roofGeo.translate(0, 0, -(w + 1.2) / 2)
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.rotation.y = Math.PI / 2
  roof.position.y = 3.25
  root.add(roof)
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), mat(0x8c6a52))
  chimney.position.set(w / 2 - 1.4, 5.6, -0.9)
  root.add(chimney)

  // Cửa chính và hai cửa sổ lớn ở mặt nam.
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 0.15), mat(0x5b341a))
  door.position.set(0, 1.4, d / 2 + 0.05)
  root.add(door)
  const glass = mat(0x9fd4f0, 0.2)
  for (const x of [-3.1, 3.1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 0.12), wood)
    frame.position.set(x, 1.9, d / 2 + 0.03)
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.14), glass)
    pane.position.set(x, 1.9, d / 2 + 0.06)
    root.add(frame, pane)
  }
  // Mái hiên sọc đỏ trắng trên cửa.
  for (let k = 0; k < 6; k++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 1.7), mat(k % 2 ? 0xfafafa : 0xd9483b))
    stripe.position.set(-1.95 + k * 0.78, 2.95, d / 2 + 0.8)
    stripe.rotation.x = 0.28
    root.add(stripe)
  }
  const sign = createSign('🍴')
  sign.position.set(0, 5.6, d / 2 + 0.2)
  sign.scale.setScalar(1.6)
  root.add(sign)
  // Biển "đóng cửa" đỏ treo trên cửa khi chưa mở nhà hàng.
  const closed = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.06), mat(0xc8372d))
  closed.position.set(0, 1.5, d / 2 + 0.2)
  root.add(closed)

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  root.position.set(RESTAURANT.x, 0, RESTAURANT.z)
  scene.add(root)

  // Bàn ngoài sân, mỗi bàn có hai ghế đối diện; ghế chỉ hiện khi bàn đã mở.
  const chairGroups: THREE.Group[] = []
  const tableGroup = new THREE.Group()
  const chairMat = mat(0x8a5a2b)
  RESTAURANT_TABLES.forEach((t, i) => {
    const g = new THREE.Group()
    g.position.set(t.x, 0, t.z)
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.03, 20), mat(0xe9d9b4))
    rug.position.y = 0.03
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 18), mat(CLOTHS[i % CLOTHS.length]))
    top.position.y = 0.8
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.78, 8), wood)
    leg.position.y = 0.4
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 8), mat(0xe8e3d8))
    vase.position.y = 0.95
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(0xf27aa3))
    flower.position.y = 1.1
    g.add(rug, top, leg, vase, flower)
    tableGroup.add(g)
    const chairs = new THREE.Group()
    chairs.position.copy(g.position)
    for (const s of [-1, 1]) {
      const c = new THREE.Group()
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.44), chairMat)
      seat.position.y = 0.46
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.06), chairMat)
      back.position.set(0, 0.78, -s * 0.19)
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), chairMat)
        l.position.set(lx, 0.22, lz)
        c.add(l)
      }
      c.add(seat, back)
      // Ghế quay mặt về phía bàn (lưng ra ngoài).
      c.position.set(s * 1.15, 0, 0)
      c.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2
      back.position.z = -0.19
      chairs.add(c)
    }
    chairGroups.push(chairs)
  })
  tableGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  for (const c of chairGroups)
    c.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
  scene.add(tableGroup, ...chairGroups)

  const v = new THREE.Vector3()
  return {
    update(state) {
      const level = state.restaurant.level
      chairGroups.forEach((g, i) => (g.visible = level > i))
      closed.visible = level === 0
    },
    hitTest(camera, x, y) {
      v.set(RESTAURANT.x, 2, RESTAURANT.z + d / 2).project(camera)
      if (v.z > 1) return false
      return Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y) < 130
    },
  }
}
