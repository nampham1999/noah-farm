import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { RESTAURANT, RESTAURANT_SPOTS, RESTAURANT_TABLES } from '../core/world.ts'
import { createSign } from './animals.ts'

export interface RestaurantView {
  update(state: GameState): void
  hitTest(camera: THREE.Camera, x: number, y: number): boolean
}

const mat = (color: number, roughness = 0.95) => new THREE.MeshStandardMaterial({ color, roughness })
const CLOTHS = [0xd9483b, 0x3f7fc4, 0x4f9a54, 0xe6b43a]

/**
 * Nhà hàng ngoài phố, dạng cắt ngang: không mái, tường trước thấp để nhìn thấy bên trong (bếp, quầy ra món, tủ lạnh),
 * mái hiên sọc trên cửa; sân trước có bốn bàn (mỗi cấp mở một bàn hai ghế).
 */
export function createRestaurantView(scene: THREE.Scene): RestaurantView {
  const root = new THREE.Group()
  const { w, d } = RESTAURANT
  const wall = mat(0xf0e2c0)
  const wood = mat(0x7a4a22)
  const stone = mat(0xb9b2a4)
  const steel = mat(0xc9ced3, 0.5)
  const dark = mat(0x3a3a40, 0.7)
  const box = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m)
    mesh.position.set(x, y, z)
    root.add(mesh)
    return mesh
  }

  // Nền và sàn gỗ bên trong.
  box(w + 0.5, 0.25, d + 0.5, stone, 0, 0.12, 0)
  box(w - 0.3, 0.06, d - 0.3, mat(0xb98b56), 0, 0.28, 0)
  // Tường bắc và hai tường hông cao đủ; tường nam (trước) thấp, chừa lối vào ở giữa.
  box(w, 3, 0.25, wall, 0, 1.75, -d / 2)
  box(0.25, 3, d, wall, -w / 2, 1.75, 0)
  box(0.25, 3, d, wall, w / 2, 1.75, 0)
  const gap = 1.5
  const seg = (w - gap) / 2
  for (const s of [-1, 1]) box(seg, 1, 0.22, wall, s * (gap / 2 + seg / 2), 0.8, d / 2)
  // Khung gỗ: cột góc và cột hai bên cửa, xà ngang phía trên mặt trước.
  for (const [x, z, h] of [[-w / 2, -d / 2, 3.2], [w / 2, -d / 2, 3.2], [-w / 2, d / 2, 3.2], [w / 2, d / 2, 3.2], [-gap / 2, d / 2, 1.5], [gap / 2, d / 2, 1.5]]) box(0.24, h, 0.24, wood, x, 0.28 + h / 2, z)
  box(w + 0.1, 0.22, 0.24, wood, 0, 3.3, -d / 2)
  // Bếp dọc tường bắc: quầy bếp có mặt bếp và nồi, máy hút mùi, kệ lọ, tủ lạnh ở góc đông.
  const sp = RESTAURANT_SPOTS
  const lx = (x: number) => x - RESTAURANT.x
  const lz = (z: number) => z - RESTAURANT.z
  box(5.6, 0.95, 0.9, wood, lx(sp.stove.x) + 1.4, 0.76, -d / 2 + 0.7)
  box(5.7, 0.08, 1.0, mat(0xe6e0d4, 0.6), lx(sp.stove.x) + 1.4, 1.27, -d / 2 + 0.7)
  box(1.2, 0.1, 0.8, dark, lx(sp.stove.x), 1.36, -d / 2 + 0.7)
  for (const dx of [-0.25, 0.25]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.28, 12), steel)
    pot.position.set(lx(sp.stove.x) + dx, 1.55, -d / 2 + 0.7)
    root.add(pot)
  }
  box(1.4, 0.7, 0.7, steel, lx(sp.stove.x), 2.45, -d / 2 + 0.55)
  box(0.3, 0.9, 0.3, steel, lx(sp.stove.x), 3.15, -d / 2 + 0.5)
  box(2.6, 0.08, 0.4, wood, lx(sp.stove.x) + 3.4, 2.2, -d / 2 + 0.3)
  for (let k = 0; k < 5; k++) {
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 8), mat([0xd9483b, 0xe6b43a, 0x4f9a54, 0x8a5aa8, 0xf27aa3][k]))
    jar.position.set(lx(sp.stove.x) + 2.4 + k * 0.5, 2.38, -d / 2 + 0.3)
    root.add(jar)
  }
  box(1.05, 2.1, 0.9, mat(0xf4f6f8, 0.5), lx(sp.fridge.x), 1.33, -d / 2 + 0.75)
  box(0.06, 0.6, 0.06, steel, lx(sp.fridge.x) - 0.4, 1.5, -d / 2 + 1.23)
  // Bàn sơ chế giữa bếp và quầy ra món có thớt và dao.
  box(1.8, 0.9, 0.9, wood, lx(sp.prep.x), 0.73, lz(sp.prep.z) - 0.5)
  box(1.9, 0.07, 1.0, mat(0xe6e0d4, 0.6), lx(sp.prep.x), 1.2, lz(sp.prep.z) - 0.5)
  box(0.7, 0.05, 0.45, mat(0xc99a5b), lx(sp.prep.x) - 0.3, 1.26, lz(sp.prep.z) - 0.5)
  // Quầy ra món sát mặt trước: các đĩa đặt chờ người phục vụ.
  box(4.2, 0.95, 0.7, wood, lx(sp.pass.x) - 0.4, 0.76, lz(sp.pass.z) + 0.55)
  box(4.3, 0.07, 0.8, mat(0xd9c29a, 0.7), lx(sp.pass.x) - 0.4, 1.27, lz(sp.pass.z) + 0.55)
  for (let k = 0; k < 4; k++) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14), mat(0xfafafa, 0.5))
    plate.position.set(lx(sp.pass.x) - 1.6 + k * 0.9, 1.33, lz(sp.pass.z) + 0.55)
    root.add(plate)
  }
  // Đèn treo trong nhà, bên đông thêm một chậu cây.
  for (const x of [-2.6, 0.2, 3]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd36b, emissiveIntensity: 0.9 }))
    lamp.position.set(x, 3.0, 0.2)
    root.add(lamp)
  }
  box(0.5, 0.45, 0.5, mat(0xa0623a), w / 2 - 0.7, 0.5, d / 2 - 0.7)
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(0x4f9a54))
  bush.position.set(w / 2 - 0.7, 1.0, d / 2 - 0.7)
  root.add(bush)
  // Ống khói trên góc đông bắc và biển 🍴 treo trên xà trước.
  box(0.8, 1.6, 0.8, mat(0x8c6a52), w / 2 - 0.9, 4.0, -d / 2 + 0.6)
  const sign = createSign('🍴')
  sign.position.set(w / 2 - 0.1, 3.5, d / 2 + 0.3)
  sign.scale.setScalar(1.3)
  root.add(sign)
  // Biển "đóng cửa" đỏ ngay lối vào khi chưa mở nhà hàng.
  const closed = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.06), mat(0xc8372d))
  closed.position.set(0, 1.5, d / 2 + 0.05)
  root.add(closed)

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
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
