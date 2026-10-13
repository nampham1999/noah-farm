import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

export interface Farmer {
  root: THREE.Group
  /** speed01: tốc độ hiện tại so với tốc độ tối đa, 0..1. */
  animate(dt: number, speed01: number): void
  /** Ngồi trên lưng thú cưỡi (dùng hoạt ảnh ngồi) hoặc đứng xuống. */
  setRiding(on: boolean): void
}

/** Độ cao chỗ ngồi trên lưng bò so với mặt đất. */
const SADDLE_Y = 0.62

/** Chiều cao nhân vật trong thế giới (m). */
const HEIGHT = 1.35
/** Vũ khí có sẵn trong mô hình KayKit; nông dân không cầm. */
const HIDDEN = ['1H_Crossbow', '2H_Crossbow', 'Knife', 'Knife_Offhand', 'Throwable']

/**
 * Nông dân: nhân vật Rogue (KayKit, CC0) như bản cũ, ẩn vũ khí và đội mũ rơm.
 * Hoạt ảnh Idle và Running_A trộn theo tốc độ đi.
 */
export interface FarmerLook {
  /** Nhuộm cả người theo màu này (dân làng); bỏ trống là giữ màu gốc. */
  tint?: string
  hat?: string
  band?: string
}

export function createFarmer(gltf: GLTF, look: FarmerLook = {}): Farmer {
  const model = cloneSkinned(gltf.scene)
  if (look.tint) {
    // Nhân bản vật liệu rồi pha màu, để không đổi màu nhân vật chính dùng chung vật liệu.
    const tint = new THREE.Color('#ffffff').lerp(new THREE.Color(look.tint), 0.55)
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as THREE.MeshStandardMaterial).clone()
        ;(o.material as THREE.MeshStandardMaterial).color.copy(tint)
      }
    })
  }
  for (const name of HIDDEN) {
    const o = model.getObjectByName(name)
    if (o) o.visible = false
  }

  const root = new THREE.Group()
  root.add(model)
  const box = new THREE.Box3().setFromObject(model)
  model.scale.setScalar(HEIGHT / (box.max.y - box.min.y))
  model.updateMatrixWorld(true)

  addStrawHat(model, look.hat, look.band)

  const mixer = new THREE.AnimationMixer(model)
  const clip = (name: string) => {
    const found = THREE.AnimationClip.findByName(gltf.animations, name)
    if (!found) throw new Error(`Farmer animation missing: ${name}`)
    return found
  }
  const idle = mixer.clipAction(clip('Idle'))
  const run = mixer.clipAction(clip('Running_A'))
  const sit = mixer.clipAction(clip('Sit_Chair_Idle'))
  idle.play()
  run.play()
  sit.play()
  run.setEffectiveWeight(0)
  sit.setEffectiveWeight(0)

  let blend = 0
  let riding = false
  return {
    root,
    setRiding(on) {
      riding = on
      model.position.y = on ? SADDLE_Y : 0
    },
    animate(dt, speed01) {
      if (riding) {
        idle.setEffectiveWeight(0)
        run.setEffectiveWeight(0)
        sit.setEffectiveWeight(1)
        mixer.update(dt)
        return
      }
      sit.setEffectiveWeight(0)
      // Chuyển dần giữa đứng và chạy để không bị giật.
      blend += (Math.min(1, speed01 * 1.5) - blend) * Math.min(1, dt * 10)
      idle.setEffectiveWeight(1 - blend)
      run.setEffectiveWeight(blend)
      run.timeScale = 0.6 + 0.5 * speed01
      mixer.update(dt)
    },
  }
}

/** Mũ rơm gắn vào xương đầu, đặt theo khung bao của mesh đầu (giống bản cũ). */
function addStrawHat(model: THREE.Object3D, hatColor = '#f2c75c', bandColor = '#d9573f'): void {
  const head = model.getObjectByName('head')
  const headMesh = model.getObjectByName('Rogue_Head')
  if (!head || !headMesh) return

  const straw = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.9 })
  const band = new THREE.MeshStandardMaterial({ color: bandColor, roughness: 0.9 })
  const hat = new THREE.Group()
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.05, 20), straw)
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.26, 16), straw)
  crown.position.y = 0.15
  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.07, 16), band)
  ribbon.position.y = 0.06
  hat.add(brim, crown, ribbon)
  hat.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })

  const box = new THREE.Box3().setFromObject(headMesh)
  const size = box.getSize(new THREE.Vector3())
  hat.scale.setScalar(size.x / 0.9)
  hat.position.set((box.min.x + box.max.x) / 2, box.max.y - size.y * 0.12, (box.min.z + box.max.z) / 2)
  hat.rotation.x = -0.1
  model.parent!.add(hat)
  hat.updateMatrixWorld(true)
  // Gắn vào xương đầu nhưng giữ nguyên vị trí thế giới, để mũ đi theo đầu khi chạy.
  head.attach(hat)
}
