import * as THREE from 'three'
import type { GameState } from '../core/state.ts'
import { plotCenter } from '../core/world.ts'
import { emojiTexture } from './animals.ts'

export interface PestsView {
  update(state: GameState, time: number): void
}

const MAX = 5

/** Con sâu 🐛 nhấp nhô trên các ô đang bị sâu. */
export function createPestsView(scene: THREE.Scene): PestsView {
  const sprites = Array.from({ length: MAX }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('🐛'), transparent: true, depthWrite: false }))
    s.scale.set(0.6, 0.6, 1)
    s.visible = false
    scene.add(s)
    return s
  })
  return {
    update(state, time) {
      sprites.forEach((s, i) => {
        const key = state.pests[i]
        s.visible = !!key && !state.player.indoors
        if (!key) return
        const [x, z] = key.split(',').map(Number)
        const c = plotCenter(x, z)
        s.position.set(c.x + Math.sin(time * 2 + i) * 0.15, 1.15 + Math.abs(Math.sin(time * 4 + i)) * 0.12, c.z)
      })
    },
  }
}
