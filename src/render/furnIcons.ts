import type * as ThreeNS from 'three'

/**
 * Icon đồ nội thất: chụp mô hình 3D thật thành ảnh nhỏ (vẽ lần lượt, nhớ lại), thay cho emoji chung chung.
 * Icon vẽ xong thì tự thay vào các chỗ đang hiện (thẻ có data-furn), không cần dựng lại bảng.
 */

const SIZE = 112
const cache = new Map<string, string>()
const queued = new Set<string>()
const queue: string[] = []
let running = false

export const furnIconUrl = (id: string): string | undefined => cache.get(id)

export const img = (id: string): string => `<img class="furn-icon" src="${cache.get(id)}" alt="" draggable="false">`

export function requestFurnIcon(id: string): void {
  if (cache.has(id) || queued.has(id)) return
  queued.add(id)
  queue.push(id)
  if (!running) void run()
}

interface Ctx {
  THREE: typeof ThreeNS
  renderer: ThreeNS.WebGLRenderer
  scene: ThreeNS.Scene
  camera: ThreeNS.PerspectiveCamera
}
let ctx: Ctx | null = null

async function setup(): Promise<Ctx> {
  const THREE = await import('three')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a58a, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  return { THREE, renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 50) }
}

async function modelOf(id: string): Promise<ThreeNS.Object3D | null> {
  const { FURNITURE_BY_ID } = await import('../data/index.ts')
  const def = FURNITURE_BY_ID.get(id)
  if (!def) return null
  const assets = await import('./assets.ts')
  if (def.model?.startsWith('kit/')) {
    const gltf = await assets.loadKitModel(def.model.slice(4))
    return gltf.scene.clone(true)
  }
  const gltf = await assets.loadFurniture()
  return gltf.scene.getObjectByName(`FurnRoot_${id}`)?.clone(true) ?? null
}

async function run(): Promise<void> {
  running = true
  while (queue.length) {
    const id = queue.shift()!
    try {
      ctx ??= await setup()
      const obj = await modelOf(id)
      if (obj) {
        const { THREE, renderer, scene, camera } = ctx
        obj.position.set(0, 0, 0)
        obj.rotation.set(0, 0, 0)
        const box = new THREE.Box3().setFromObject(obj)
        const center = box.getCenter(new THREE.Vector3())
        const radius = box.getSize(new THREE.Vector3()).length() / 2
        scene.add(obj)
        const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.95
        camera.position.copy(center).add(new THREE.Vector3(0.75, 0.6, 1).normalize().multiplyScalar(dist))
        camera.lookAt(center)
        renderer.render(scene, camera)
        cache.set(id, renderer.domElement.toDataURL('image/png'))
        scene.remove(obj)
        for (const el of document.querySelectorAll<HTMLElement>(`[data-furn="${id}"]`)) el.innerHTML = img(id)
      }
    } catch (e) {
      console.warn('Furn icon', id, e)
    }
    // Nhường khung hình cho game giữa các lần vẽ.
    await new Promise((r) => setTimeout(r, 30))
  }
  running = false
}
