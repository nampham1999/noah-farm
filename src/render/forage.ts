import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { FORAGE_CONFIG } from '../data/index.ts'
import { remainingSpots } from '../systems/forage.ts'
import { emojiTexture } from './animals.ts'

export interface ForageView {
  update(state: GameState, time: number, visible: boolean): void
}

/** Đồ rừng chưa hái: biểu tượng nhỏ nhấp nhô trên nền đất, chỉ vẽ khi người chơi ở ngoài trời. */
export function createForageView(scene: THREE.Scene): ForageView {
  const sprites = Array.from({ length: FORAGE_CONFIG.spawnCount }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
    s.scale.set(0.85, 0.85, 1)
    s.visible = false
    scene.add(s)
    return s
  })
  const glow = sprites.map(() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.45, depthWrite: false }))
    m.rotation.x = -Math.PI / 2
    m.visible = false
    scene.add(m)
    return m
  })
  return {
    update(state, time, visible) {
      const spots = visible ? remainingSpots(state) : []
      sprites.forEach((s, i) => {
        const spot = spots[i]
        s.visible = glow[i].visible = !!spot
        if (!spot) return
        const mat = s.material as THREE.SpriteMaterial
        const map = emojiTexture(spot.def.icon)
        if (mat.map !== map) {
          mat.map = map
          mat.needsUpdate = true
        }
        s.position.set(spot.x, 0.42 + Math.sin(time * 2.4 + i) * 0.06, spot.z)
        glow[i].position.set(spot.x, 0.04, spot.z)
        glow[i].scale.setScalar(1 + Math.sin(time * 3 + i) * 0.12)
      })
    },
  }
}
