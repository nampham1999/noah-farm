import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { ORDER_BOARD, STALL, VILLAGE } from '../core/world.ts'
import { festivalToday } from '../systems/festival.ts'

export interface FestivalView {
  update(state: GameState, time: number): void
}

const FLAG_COLORS = [0xe2483a, 0xffc93a, 0x4a90d9, 0x7cb342, 0xe88fb0, 0xf4efe2]

/** Ngày lễ hội: dây cờ đuôi nheo quanh quầy hàng và bảng đơn; mùa đông thêm đèn lồng quanh làng. */
export function createFestivalView(scene: THREE.Scene): FestivalView {
  const decor = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 })
  const rope = new THREE.LineBasicMaterial({ color: 0x5a3a24 })
  const flagGeo = new THREE.BufferGeometry()
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.14, 0, 0, 0.14, 0, 0, 0, -0.3, 0], 3))
  flagGeo.computeVertexNormals()
  const flagMats = FLAG_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 }))

  // Dây cờ võng giữa các cột.
  const posts: [number, number][] = [
    [STALL.x - 3, STALL.z + 3.6], [STALL.x + 3, STALL.z + 3.6], [ORDER_BOARD.x - 1.5, ORDER_BOARD.z + 1.4], [VILLAGE.x + 2.4, VILLAGE.z + 1.6],
  ]
  const top = 2.6
  for (const [x, z] of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, top, 6), wood)
    post.position.set(x, top / 2, z)
    post.castShadow = true
    decor.add(post)
  }
  let flagIndex = 0
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax, az] = posts[i]
    const [bx, bz] = posts[i + 1]
    const pts: THREE.Vector3[] = []
    const n = Math.max(4, Math.round(Math.hypot(bx - ax, bz - az) / 0.5))
    for (let k = 0; k <= n; k++) {
      const u = k / n
      pts.push(new THREE.Vector3(ax + (bx - ax) * u, top - 0.5 * 4 * u * (1 - u), az + (bz - az) * u))
    }
    decor.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), rope))
    for (let k = 1; k < n; k++) {
      const flag = new THREE.Mesh(flagGeo, flagMats[flagIndex++ % flagMats.length])
      flag.position.copy(pts[k])
      flag.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2
      decor.add(flag)
    }
  }

  // Đèn lồng đỏ phát sáng quanh làng (lễ hội đèn lồng mùa đông).
  const lanterns = new THREE.Group()
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xe2483a, emissive: 0xff5a2a, emissiveIntensity: 1.2, roughness: 0.6 })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const x = VILLAGE.x + Math.cos(a) * (VILLAGE.r + 1)
    const z = VILLAGE.z + Math.sin(a) * (VILLAGE.r + 1)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6), wood)
    pole.position.set(x, 0.9, z)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), lanternMat)
    lamp.scale.y = 1.25
    lamp.position.set(x, 1.95, z)
    lanterns.add(pole, lamp)
  }
  decor.add(lanterns)

  decor.visible = false
  scene.add(decor)
  return {
    update(state, time) {
      const id = festivalToday(state)
      decor.visible = id !== null && !state.player.indoors
      if (!decor.visible) return
      lanterns.visible = id === 'lantern'
      lanternMat.emissiveIntensity = 1 + Math.sin(time * 2) * 0.2
    },
  }
}
