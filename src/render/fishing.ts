import * as THREE from 'three'
import type { PlayerState } from '../core/state.ts'
import { fishing } from '../systems/fishing.ts'

export interface FishingView {
  update(player: PlayerState, time: number): void
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

  return {
    update(player, time) {
      const active = fishing.phase !== 'idle'
      bobber.visible = ring.visible = line.visible = active
      if (!active) return

      const bite = fishing.phase === 'bite'
      const reeling = fishing.phase === 'reeling'
      // Cá cắn: phao giật chìm xuống; đang kéo: phao rung mạnh.
      const y = bite ? -0.06 + Math.sin(time * 30) * 0.03 : reeling ? 0.04 + Math.sin(time * 18) * 0.03 : 0.06 + Math.sin(time * 2.5) * 0.02
      bobber.position.set(fishing.x, y, fishing.z)
      ring.position.set(fishing.x, 0.06, fishing.z)
      const pulse = (time * (bite ? 3 : 0.8)) % 1
      ring.scale.setScalar(1 + pulse * (bite ? 3 : 1.5))
      ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.8

      // Dây câu từ tay (trước mặt, ngang vai) tới phao.
      const hx = player.pos[0] + Math.sin(player.rotY) * 0.45
      const hz = player.pos[2] + Math.cos(player.rotY) * 0.45
      linePos.set([hx, 1.25, hz, fishing.x, y + 0.19, fishing.z])
      lineGeo.attributes.position.needsUpdate = true
    },
  }
}
