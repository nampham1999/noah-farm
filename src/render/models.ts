import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { ACTION_SECONDS, ACTION_TOOL, makeTool, toolTip, type ActionName, type ToolName } from './tools.ts'

export interface Farmer {
  root: THREE.Group
  /** speed01: tốc độ hiện tại so với tốc độ tối đa, 0..1. */
  animate(dt: number, speed01: number): void
  /** Ngồi trên lưng thú cưỡi (dùng hoạt ảnh ngồi) hoặc đứng xuống. */
  setRiding(on: boolean): void
  /** Làm một động tác (cuốc, tưới, quăng cần...), cầm dụng cụ phù hợp trên tay. */
  playAction?(name: ActionName): void
  /** Câu cá: 'hold' cầm cần chờ cá, 'reel' đang kéo (cần rung), 'none' cất cần. */
  setFishing?(mode: FishingPose): void
  /** Vị trí thế giới của đầu cần câu (để nối dây); false nếu không cầm cần. */
  rodTip?(out: THREE.Vector3): boolean
}

export type FishingPose = 'none' | 'hold' | 'reel'

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

/** Tỉ lệ dụng cụ trong thế giới, bằng của nhân vật tự tạo (1.25 x 1.12). */
const TOOL_WORLD_SCALE = 1.4

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

  // Động tác làm việc: mỗi việc một đoạn hoạt ảnh có sẵn trong bộ KayKit, chạy một lần.
  const ACTION_CLIP: Record<ActionName, string> = {
    hoe: '1H_Melee_Attack_Chop',
    water: 'Interact',
    plant: 'PickUp',
    harvest: 'PickUp',
    cast: 'Throw',
    cheer: 'Cheer',
    pet: 'Interact',
  }
  const actions = new Map<ActionName, THREE.AnimationAction>()
  for (const [name, clipName] of Object.entries(ACTION_CLIP) as [ActionName, string][]) {
    const a = mixer.clipAction(clip(clipName))
    a.setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = true
    actions.set(name, a)
  }

  // Dụng cụ cầm ở tay phải (xương handslot.r; GLTFLoader bỏ dấu chấm khỏi tên), bù lại tỉ lệ thu nhỏ của bộ xương.
  const hand = model.getObjectByName('handslotr') ?? model.getObjectByName('handslot.r')
  const handScale = new THREE.Vector3()
  let held: { name: ToolName; obj: THREE.Object3D } | null = null
  const rodAim = new THREE.Quaternion()
  const rodTilt = new THREE.Quaternion()
  const rodEuler = new THREE.Euler()
  const handQuat = new THREE.Quaternion()
  /** Hướng cần khi cầm bình thường (cán theo tay). */
  const rodGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
  const hold = (name: ToolName | null) => {
    if (held?.name === name) return
    if (held) held.obj.removeFromParent()
    held = null
    const obj = name && hand ? makeTool(name) : null
    if (!obj || !hand || !name) return
    // Đặt tỉ lệ theo thế giới cho bằng dụng cụ của nhân vật tự tạo, dù bộ xương thu nhỏ bao nhiêu.
    hand.getWorldScale(handScale)
    obj.scale.setScalar(TOOL_WORLD_SCALE / (handScale.x || 1))
    // Cán dụng cụ chạy theo +Z; xương tay của KayKit cầm đồ theo trục +Y.
    obj.rotation.x = Math.PI / 2
    hand.add(obj)
    held = { name, obj }
  }

  let blend = 0
  let riding = false
  let current: { name: ActionName; action: THREE.AnimationAction; left: number } | null = null
  let fishing: FishingPose = 'none'
  let time = 0
  return {
    root,
    setRiding(on) {
      riding = on
      model.position.y = on ? SADDLE_Y : 0
    },
    playAction(name) {
      const action = actions.get(name)!
      if (current && current.action !== action) current.action.fadeOut(0.1)
      action.reset().setEffectiveWeight(1).fadeIn(0.08).play()
      current = { name, action, left: ACTION_SECONDS[name] }
      hold(ACTION_TOOL[name] ?? (fishing !== 'none' ? 'fishing_rod' : null))
    },
    setFishing(mode) {
      if (mode === fishing) return
      fishing = mode
      if (mode === 'none') {
        if (current?.name === 'cast') current.action.fadeOut(0.25)
        current = null
        hold(null)
      } else {
        hold('fishing_rod')
      }
    },
    rodTip(out) {
      if (held?.name !== 'fishing_rod') return false
      const tip = toolTip(held.obj)
      if (!tip) return false
      tip.getWorldPosition(out)
      return true
    },
    animate(dt, speed01) {
      time += dt
      if (riding) {
        idle.setEffectiveWeight(0)
        run.setEffectiveWeight(0)
        sit.setEffectiveWeight(1)
        mixer.update(dt)
        return
      }
      sit.setEffectiveWeight(0)
      // Đang câu thì giữ nguyên tư thế cuối của động tác quăng cần.
      if (current && !(current.name === 'cast' && fishing !== 'none')) {
        current.left -= dt
        if (current.left <= 0) {
          current.action.fadeOut(0.2)
          current = null
          if (fishing === 'none') hold(null)
        }
      }
      const acting = current ? 1 : 0
      // Chuyển dần giữa đứng và chạy để không bị giật.
      blend += (Math.min(1, speed01 * 1.5) - blend) * Math.min(1, dt * 10)
      idle.setEffectiveWeight((1 - blend) * (1 - acting))
      run.setEffectiveWeight(blend * (1 - acting))
      run.timeScale = 0.6 + 0.5 * speed01
      mixer.update(dt)
      // Đang chờ cá: tư thế cuối của động tác ném không chỉ cần ra trước, nên đặt hướng cần
      // theo nhân vật (chĩa ra trước, hếch lên), không theo xương tay. Kéo cá thì cần rung.
      if (held?.name === 'fishing_rod' && fishing !== 'none' && hand) {
        // Trong lúc vung thì cần theo tay; sau đó chuyển dần sang hướng chĩa ra nước.
        const clip = current?.name === 'cast' ? current.action.time / current.action.getClip().duration : 1
        const w = THREE.MathUtils.smoothstep(clip, 0.35, 0.7)
        const jitter = fishing === 'reel' ? Math.sin(time * 28) * 0.08 : 0
        root.getWorldQuaternion(rodAim).multiply(rodTilt.setFromEuler(rodEuler.set(-0.5 + jitter, 0, jitter)))
        hand.updateWorldMatrix(true, false)
        rodAim.premultiply(hand.getWorldQuaternion(handQuat).invert())
        held.obj.quaternion.copy(rodGrip).slerp(rodAim, w)
      }
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
