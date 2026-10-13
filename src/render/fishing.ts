import * as THREE from 'three'
import type { PlayerState } from '../core/state.ts'
import { fishing } from '../systems/fishing.ts'

/** Giây từ lúc bắt đầu quăng tới lúc nhả phao, và thời gian phao bay. */
const CAST_RELEASE = 0.32
const CAST_FLIGHT = 0.5
/** Số đoạn của dây câu. */
const LINE_SEGMENTS = 12

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

  // Dây câu là đường cong nhiều đoạn để võng xuống tự nhiên.
  const linePos = new Float32Array(LINE_SEGMENTS * 3 + 3)
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf6f0e0 }))
  line.frustumCulled = false

  scene.add(bobber, ring, line)

  /** Vẽ dây từ a tới b, võng xuống giữa một đoạn sag (mét). */
  const drawLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) => {
    for (let n = 0; n <= LINE_SEGMENTS; n++) {
      const u = n / LINE_SEGMENTS
      linePos[n * 3] = ax + (bx - ax) * u
      linePos[n * 3 + 1] = ay + (by - ay) * u - sag * 4 * u * (1 - u)
      linePos[n * 3 + 2] = az + (bz - az) * u
    }
    lineGeo.attributes.position.needsUpdate = true
  }

  // Lúc quăng cần: chờ nhân vật vung cần rồi mới cho phao bay vòng cung xuống nước.
  let castAt = -1
  // Độ võng hiện tại của dây, đổi dần cho mượt (căng khi kéo cá, chùng khi chờ).
  let sag = 0
  let last = 0

  return {
    update(player, time, rodTip) {
      const active = fishing.phase !== 'idle'
      const prev = last
      last = time
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
        // Phao bay từ đầu cần theo đường vòng cung (nhanh lúc đầu, chậm dần), dây kéo theo.
        const k = (since - CAST_RELEASE) / CAST_FLIGHT
        const e = 1 - (1 - k) * (1 - k)
        bobber.position.set(hx + (fishing.x - hx) * e, hy + (0.06 - hy) * k + Math.sin(k * Math.PI) * 1.1, hz + (fishing.z - hz) * e)
        bobber.rotation.z = (1 - k) * 0.8
        ring.visible = false
        sag = 0.05
        drawLine(hx, hy, hz, bobber.position.x, bobber.position.y + 0.19, bobber.position.z, sag)
        return
      }
      bobber.rotation.z = 0

      const bite = fishing.phase === 'bite'
      const reeling = fishing.phase === 'reeling'
      // Vừa rơi xuống nước: phao chìm nhẹ rồi nổi lên.
      const landed = since - CAST_RELEASE - CAST_FLIGHT
      const plop = landed < 0.6 ? -Math.sin((landed / 0.6) * Math.PI) * 0.08 * (1 - landed / 0.6) : 0
      // Cá cắn: phao giật chìm xuống; đang kéo: phao rung mạnh.
      const y = bite ? -0.06 + Math.sin(time * 30) * 0.03 : reeling ? 0.04 + Math.sin(time * 18) * 0.03 : 0.06 + Math.sin(time * 2.5) * 0.02 + plop
      bobber.position.set(fishing.x, y, fishing.z)
      ring.position.set(fishing.x, 0.06, fishing.z)
      // Vòng sóng bắt đầu lan từ lúc phao chạm nước.
      const pulse = (landed * (bite ? 3 : 0.8)) % 1
      ring.scale.setScalar(1 + pulse * (bite ? 3 : 1.5))
      ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.8

      // Dây câu từ đầu cần (nếu biết) xuống phao: chùng khi chờ, căng khi cá cắn hoặc đang kéo.
      const targetSag = bite || reeling ? 0.02 : Math.hypot(fishing.x - hx, fishing.z - hz) * 0.12
      sag += (targetSag - sag) * Math.min(1, Math.max(0, time - prev) * 6)
      drawLine(hx, hy, hz, fishing.x, y + 0.19, fishing.z, sag)
    },
  }
}
