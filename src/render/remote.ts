import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { presence, type RemotePlayer } from '../online/presence.ts'
import { emojiTexture } from './animals.ts'
import { createCharacter, disposeCharacter } from './character.ts'
import { createFarmer, type Farmer } from './models.ts'

export interface RemoteView {
  update(dt: number, localIndoors: boolean): void
  /** Hiện bong bóng biểu cảm trên đầu nhân vật của mình. */
  showOwnEmote(e: string, root: THREE.Object3D): void
}

/** Biểu cảm hiện chừng này giây rồi tắt. */
const EMOTE_SECONDS = 4

interface Avatar {
  farmer: Farmer
  label: THREE.Sprite
  bubble: THREE.Sprite
  bubbleUntil: number
  lookKey: string
  x: number
  z: number
  r: number
}

/** Người chơi khác đang ở cùng nông trại: nhân vật theo ngoại hình của họ, bảng tên, bong bóng biểu cảm. */
export function createRemoteView(scene: THREE.Scene, rogue: GLTF): RemoteView {
  const avatars = new Map<string, Avatar>()
  let time = 0
  const ownBubble = makeBubble()
  let ownUntil = 0

  const build = (p: RemotePlayer): Avatar => {
    const farmer = p.look ? createCharacter(p.look) : createFarmer(rogue)
    const label = nameTag(p.name)
    label.position.y = 2.35
    farmer.root.add(label)
    const bubble = makeBubble()
    farmer.root.add(bubble)
    scene.add(farmer.root)
    return { farmer, label, bubble, bubbleUntil: 0, lookKey: JSON.stringify(p.look), x: p.x, z: p.z, r: p.r }
  }
  const drop = (uid: string) => {
    const a = avatars.get(uid)
    if (!a) return
    scene.remove(a.farmer.root)
    disposeCharacter(a.farmer.root)
    avatars.delete(uid)
  }
  const setBubble = (sprite: THREE.Sprite, e: string) => {
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map = e.length <= 2 ? emojiTexture(e) : textTexture(e)
    mat.needsUpdate = true
    sprite.scale.set(e.length <= 2 ? 0.7 : 2.2, 0.7, 1)
    sprite.visible = true
  }

  return {
    update(dt, localIndoors) {
      time += dt
      for (const uid of avatars.keys()) if (!presence.players.has(uid)) drop(uid)
      for (const p of presence.players.values()) {
        let a = avatars.get(p.uid)
        // Đổi ngoại hình thì dựng lại nhân vật.
        if (a && a.lookKey !== JSON.stringify(p.look)) {
          drop(p.uid)
          a = undefined
        }
        a ??= avatars.set(p.uid, build(p)).get(p.uid)!
        // Trượt mượt tới vị trí mới nhận (gửi 5 lần/giây).
        const k = Math.min(1, dt * 10)
        a.x += (p.x - a.x) * k
        a.z += (p.z - a.z) * k
        a.r += Math.atan2(Math.sin(p.r - a.r), Math.cos(p.r - a.r)) * k
        a.farmer.root.position.set(a.x, 0, a.z)
        a.farmer.root.rotation.y = a.r
        a.farmer.root.visible = p.in === localIndoors
        a.farmer.animate(dt, Math.hypot(p.x - a.x, p.z - a.z) > 0.05 ? Math.max(p.s, 0.5) : 0)
        if (p.e && p.et && Date.now() - p.et < EMOTE_SECONDS * 1000 && a.bubbleUntil < time) {
          setBubble(a.bubble, p.e)
          a.bubbleUntil = time + EMOTE_SECONDS - (Date.now() - p.et) / 1000
        }
        a.bubble.visible = time < a.bubbleUntil
        a.bubble.position.y = 2.9 + Math.sin(time * 3) * 0.05
      }
      ownBubble.visible = time < ownUntil
      ownBubble.position.y = 2.6 + Math.sin(time * 3) * 0.05
    },
    showOwnEmote(e, root) {
      if (ownBubble.parent !== root) root.add(ownBubble)
      setBubble(ownBubble, e)
      ownUntil = time + EMOTE_SECONDS
    },
  }
}

function makeBubble(): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
  s.scale.set(0.7, 0.7, 1)
  s.visible = false
  s.renderOrder = 10
  return s
}

/** Bảng tên: chữ trắng viền nâu trên nền nâu mờ. */
function nameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(78,42,12,0.65)'
  g.beginPath()
  g.roundRect(8, 10, 240, 44, 22)
  g.fill()
  g.font = 'bold 28px Fredoka, Nunito, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fffaf0'
  g.fillText(name.slice(0, 14), 128, 33)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  s.scale.set(1.6, 0.4, 1)
  return s
}

const textCache = new Map<string, THREE.Texture>()

/** Bong bóng câu nói nhanh (chữ trên nền giấy). */
function textTexture(text: string): THREE.Texture {
  let tex = textCache.get(text)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,250,240,0.97)'
  g.strokeStyle = '#b06e33'
  g.lineWidth = 8
  g.beginPath()
  g.roundRect(8, 8, 496, 144, 60)
  g.fill()
  g.stroke()
  g.font = 'bold 44px Fredoka, Nunito, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#4a2e14'
  g.fillText(text.slice(0, 18), 256, 82)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  textCache.set(text, tex)
  return tex
}
