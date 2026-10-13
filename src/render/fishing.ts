import * as THREE from 'three'
import type { PlayerState } from '../core/state.ts'
import { fishing } from '../systems/fishing.ts'

/** Giây từ lúc bắt đầu quăng tới lúc nhả phao, và thời gian phao bay. */
const CAST_RELEASE = 0.32
const CAST_FLIGHT = 0.45

export interface FishingView {
  /** rodTip: vị trí đầu cần câu trong tay nhân vật (null thì ước lượng trước mặt). */
  update(player: PlayerState, time: number, rodTip: THREE.Vector3 | null): void
}

/** Phao đỏ trắng bập bềnh, chìm xuống khi cá cắn, nối với nhân vật bằng dây câu. */
export function createFishingView(scene: THREE.Scene): FishingView {
  const bobber = new THREE.Group()
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe2483a, roughness: 0.5 }))
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }))
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4), new THREE.MeshStandardMaterial({ color: 0x333333 }))
  stick.position.y = 0.12
  bobber.add(top, bottom, stick)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2

  const linePos = new Float32Array(6)
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf6f0e0 }))
  line.frustumCulled = false

  scene.add(bobber, ring, line)

  // Lúc quăng cần: chờ nhân vật vung cần rồi mới cho phao bay vòng cung xuống nước.
  let castAt = -1
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()

  return {
    update(player, time, rodTip) {
      const active = fishing.phase !== 'idle'
      if (!active) castAt = -1
      else if (castAt < 0) castAt = time
      bobber.visible = ring.visible = line.visible = active
      if (!active) return

      const hx = rodTip?.x ?? player.pos[0] + Math.sin(player.rotY) * 0.45
      const hy = rodTip?.y ?? 1.25
      const hz = rodTip?.z ?? player.pos[2] + Math.cos(player.rotY) * 0.45
      const since = time - castAt
      if (since < CAST_RELEASE) {
        // Đang vung cần: chưa có dây, chưa có phao.
        bobber.visible = ring.visible = line.visible = false
        return
      }
      if (since < CAST_RELEASE + CAST_FLIGHT) {
        // Phao bay từ đầu cần theo đường vòng cung, dây kéo theo.
        const k = (since - CAST_RELEASE) / CAST_FLIGHT
        from.set(hx, hy, hz)
        bobber.position.lerpVectors(from, to.set(fishing.x, 0.06, fishing.z), k)
        bobber.position.y += Math.sin(k * Math.PI) * 1.2
        ring.visible = false
        linePos.set([hx, hy, hz, bobber.position.x, bobber.position.y + 0.19, bobber.position.z])
        lineGeo.attributes.position.needsUpdate = true
        return
      }

      const bite = fishing.phase === 'bite'
      const reeling = fishing.phase === 'reeling'
      // Cá cắn: phao giật chìm xuống; đang kéo: phao rung mạnh.
      const y = bite ? -0.06 + Math.sin(time * 30) * 0.03 : reeling ? 0.04 + Math.sin(time * 18) * 0.03 : 0.06 + Math.sin(time * 2.5) * 0.02
      bobber.position.set(fishing.x, y, fishing.z)
      ring.position.set(fishing.x, 0.06, fishing.z)
      const pulse = (time * (bite ? 3 : 0.8)) % 1
      ring.scale.setScalar(1 + pulse * (bite ? 3 : 1.5))
      ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.8

      // Dây câu từ đầu cần (nếu biết) xuống phao.
      linePos.set([hx, hy, hz, fishing.x, y + 0.19, fishing.z])
      lineGeo.attributes.position.needsUpdate = true
    },
  }
}
