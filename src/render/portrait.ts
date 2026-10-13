import * as THREE from 'three'
import type { Look } from '../core/look.ts'
import { createCharacter } from './character.ts'

/**
 * Ảnh chân dung (đầu và vai) của nhân vật tự tạo cho avatar trên HUD.
 * Dùng một bộ vẽ nhỏ riêng, vẽ một lần rồi bỏ; trả về data URL, hoặc null nếu không vẽ được.
 */
export function renderPortrait(look: Look, size = 160): string | null {
  let renderer: THREE.WebGLRenderer | null = null
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a6a4a, 2.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(1.5, 3, 4)
    scene.add(key)

    const character = createCharacter(look)
    character.animate(0, 0)
    scene.add(character.root)
    character.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(character.root)
    const h = box.max.y - box.min.y
    // Khung đầu và vai: nhìn hơi từ trên xuống, chính diện.
    const target = new THREE.Vector3(0, box.max.y - h * 0.3, 0)
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50)
    camera.position.set(0, target.y + h * 0.08, h * 1.55)
    camera.lookAt(target)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/png')
  } catch {
    return null
  } finally {
    renderer?.dispose()
    renderer?.forceContextLoss()
  }
}
