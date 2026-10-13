import * as THREE from 'three'
import { staticModel } from './instancing.ts'
import type { Farmer } from './models.ts'

/**
 * Bộ dựng nhân vật chibi low-poly bằng khối cơ bản: nam/nữ, trẻ con/người lớn/người già,
 * nhiều kiểu tóc, râu, mũ, trang phục. Mỗi nhân vật gộp còn 5 khối (thân và đầu, hai tay,
 * hai chân) nên vẫn có hoạt ảnh bước đi mà ít lần gọi vẽ.
 */
export interface Look {
  body: 'male' | 'female'
  age: 'child' | 'adult' | 'elder'
  skin: string
  hair: string
  hairStyle: 'short' | 'long' | 'bun' | 'ponytail' | 'curly' | 'bald'
  beard?: 'full' | 'mustache'
  shirt: string
  pants: string
  /** Mặc váy (thay cho quần, chân thò dưới váy). */
  dress?: boolean
  shoes?: string
  hat?: 'straw' | 'cap' | 'chef' | 'bucket' | 'scarf'
  hatColor?: string
  apron?: string
  glasses?: boolean
  /** Người già chống gậy. */
  cane?: boolean
}

const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 })

function mesh(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color))
  m.position.set(x, y, z)
  return m
}

const sphere = (r: number, color: string, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  const m = mesh(new THREE.SphereGeometry(r, 14, 10), color, x, y, z)
  m.scale.set(sx, sy, sz)
  return m
}

const capsule = (r: number, len: number, color: string, x = 0, y = 0, z = 0) =>
  mesh(new THREE.CapsuleGeometry(r, len, 4, 10), color, x, y, z)

/** Gộp một nhóm khối thành một mesh (màu theo đỉnh) và giữ nguyên vị trí gốc nhóm. */
function bake(group: THREE.Group): THREE.Object3D {
  const baked = staticModel(group)
  baked.position.copy(group.position)
  baked.rotation.copy(group.rotation)
  return baked
}

export function createCharacter(look: Look): Farmer {
  const female = look.body === 'female'
  const child = look.age === 'child'
  const elder = look.age === 'elder'
  // Trẻ con thấp và đầu to so với người; người già thấp hơn một chút.
  const scale = child ? 0.8 : elder ? 1.04 : 1.12
  const headR = child ? 0.24 : 0.2
  const shoes = look.shoes ?? '#5a3a24'

  const legLen = 0.3
  const hipY = 0.5
  const torsoH = 0.36
  const shoulderY = hipY + torsoH - 0.02
  const headY = hipY + torsoH + headR * 0.95

  // ---------- Thân, đầu, tóc, mũ (một khối) ----------
  const upper = new THREE.Group()
  const torso = capsule(female ? 0.15 : 0.17, torsoH - 0.12, look.shirt, 0, hipY + torsoH / 2)
  torso.scale.z = 0.8
  upper.add(torso)
  if (look.dress) {
    const skirt = mesh(new THREE.ConeGeometry(0.27, 0.42, 14, 1, true), look.pants, 0, hipY - 0.06)
    upper.add(skirt)
  } else {
    upper.add(capsule(0.16, 0.06, look.pants, 0, hipY + 0.02))
  }
  if (look.apron) {
    const apron = mesh(new THREE.BoxGeometry(0.24, 0.38, 0.02), look.apron, 0, hipY + 0.06, 0.135)
    upper.add(apron)
  }
  upper.add(capsule(0.05, 0.04, look.skin, 0, hipY + torsoH + 0.02))

  // Đầu, mắt, má hồng, mũi.
  upper.add(sphere(headR, look.skin, 0, headY, 0, 1, 0.95, 0.95))
  const eyeY = headY + headR * 0.08
  const eyeZ = headR * 0.86
  for (const side of [-1, 1]) {
    upper.add(sphere(headR * 0.11, '#2b1d14', side * headR * 0.36, eyeY, eyeZ, 1, 1.25, 0.6))
    upper.add(sphere(headR * 0.12, '#f2a08c', side * headR * 0.55, eyeY - headR * 0.32, eyeZ * 0.92, 1, 0.6, 0.3))
  }
  upper.add(sphere(headR * 0.1, look.skin, 0, eyeY - headR * 0.16, eyeZ + 0.01, 1, 0.9, 0.8))

  addHair(upper, look, headY, headR)
  if (look.beard === 'full') upper.add(sphere(headR * 0.7, look.hair, 0, headY - headR * 0.55, headR * 0.42, 1, 0.8, 0.6))
  if (look.beard === 'mustache') {
    const m = capsule(headR * 0.08, headR * 0.4, look.hair, 0, eyeY - headR * 0.32, eyeZ + 0.01)
    m.rotation.z = Math.PI / 2
    upper.add(m)
  }
  if (look.glasses) {
    for (const side of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(headR * 0.2, headR * 0.035, 6, 14), '#3a2a1e', side * headR * 0.36, eyeY, eyeZ + 0.02)
      upper.add(ring)
    }
    const bridge = mesh(new THREE.BoxGeometry(headR * 0.3, headR * 0.05, headR * 0.05), '#3a2a1e', 0, eyeY, eyeZ + 0.03)
    upper.add(bridge)
  }
  addHat(upper, look, headY, headR)
  // Người già hơi còng về phía trước.
  if (elder) upper.rotation.x = 0.12

  // ---------- Tay và chân (xoay quanh vai, hông khi bước) ----------
  const limb = (x: number, y: number, build: (g: THREE.Group) => void) => {
    const g = new THREE.Group()
    build(g)
    g.position.set(x, y, 0)
    return g
  }
  const armX = female ? 0.2 : 0.22
  const makeArm = (side: number) =>
    limb(side * armX, shoulderY, (g) => {
      const sleeve = capsule(0.055, 0.2, look.shirt, 0, -0.14)
      g.add(sleeve, sphere(0.06, look.skin, 0, -0.3))
      if (look.cane && side === 1) {
        const cane = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), '#8a5a2b', 0, -0.48, 0.06)
        g.add(cane)
      }
    })
  const makeLeg = (side: number) =>
    limb(side * 0.085, hipY, (g) => {
      g.add(capsule(0.065, legLen - 0.1, look.dress ? look.skin : look.pants, 0, -legLen / 2))
      g.add(sphere(0.075, shoes, 0, -legLen + 0.01, 0.03, 1, 0.6, 1.4))
    })

  const parts = {
    upper: bake(upper),
    armL: bake(makeArm(-1)),
    armR: bake(makeArm(1)),
    legL: bake(makeLeg(-1)),
    legR: bake(makeLeg(1)),
  }
  const body = new THREE.Group()
  body.add(parts.upper, parts.armL, parts.armR, parts.legL, parts.legR)
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  const root = new THREE.Group()
  body.scale.setScalar(scale)
  root.add(body)

  let phase = Math.random() * 6
  let riding = false
  const pace = elder ? 0.7 : child ? 1.3 : 1
  return {
    root,
    setRiding(on) {
      riding = on
    },
    animate(dt, speed01) {
      if (riding) {
        parts.legL.rotation.x = parts.legR.rotation.x = -1.3
        return
      }
      phase += dt * (3 + 9 * speed01) * pace
      const swing = Math.sin(phase) * 0.65 * speed01
      parts.legL.rotation.x = swing
      parts.legR.rotation.x = -swing
      parts.armL.rotation.x = -swing * 0.8
      parts.armR.rotation.x = swing * (look.cane ? 0.3 : 0.8)
      // Đi thì nhún, đứng thì thở nhẹ.
      body.position.y = Math.abs(Math.sin(phase)) * 0.05 * speed01 * scale
      parts.upper.scale.y = 1 + Math.sin(phase * 0.5) * 0.012 * (1 - speed01)
    },
  }
}

function addHair(g: THREE.Group, look: Look, headY: number, r: number): void {
  const hair = look.hair
  // Mũ tóc: nửa trên của khối cầu, hơi to hơn đầu, phủ ra sau gáy.
  const cap = (extraBack = 0) => {
    const m = mesh(new THREE.SphereGeometry(r * 1.07, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, headY + r * 0.02, -r * 0.04 - extraBack)
    m.rotation.x = -0.25
    return m
  }
  switch (look.hairStyle) {
    case 'short':
      g.add(cap())
      break
    case 'long': {
      g.add(cap())
      const back = mesh(new THREE.BoxGeometry(r * 1.8, r * 1.9, r * 0.5), hair, 0, headY - r * 0.55, -r * 0.62)
      g.add(back)
      break
    }
    case 'bun':
      g.add(cap(), sphere(r * 0.42, hair, 0, headY + r * 0.92, -r * 0.45))
      break
    case 'ponytail': {
      g.add(cap())
      const tail = capsule(r * 0.22, r * 1.1, hair, 0, headY - r * 0.35, -r * 1.05)
      tail.rotation.x = 0.35
      g.add(tail, sphere(r * 0.16, '#e2483a', 0, headY + r * 0.3, -r * 0.95))
      break
    }
    case 'curly':
      g.add(cap())
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        g.add(sphere(r * 0.3, hair, Math.cos(a) * r * 0.85, headY + r * 0.35 + Math.sin(i) * r * 0.1, Math.sin(a) * r * 0.75 - r * 0.15))
      }
      break
    case 'bald':
      // Tóc bạc hai bên thái dương.
      for (const side of [-1, 1]) g.add(sphere(r * 0.32, hair, side * r * 0.88, headY - r * 0.05, -r * 0.25, 0.7, 1, 1.2))
      break
  }
}

function addHat(g: THREE.Group, look: Look, headY: number, r: number): void {
  const color = look.hatColor ?? '#f2c75c'
  const top = headY + r * 0.78
  switch (look.hat) {
    case 'straw':
      g.add(mesh(new THREE.CylinderGeometry(r * 2.1, r * 2.2, r * 0.12, 18), color, 0, top, 0))
      g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.1, r * 0.75, 16), color, 0, top + r * 0.38, 0))
      g.add(mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.18, 16), '#d9573f', 0, top + r * 0.12, 0))
      break
    case 'cap': {
      // Đặt cao để vành mũ nằm trên mắt.
      g.add(mesh(new THREE.SphereGeometry(r * 1.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, headY + r * 0.32, 0))
      const visor = mesh(new THREE.BoxGeometry(r * 1.3, r * 0.08, r * 0.8), color, 0, headY + r * 0.36, r * 1.05)
      g.add(visor)
      break
    }
    case 'chef':
      g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.0, r * 1.0, 16), '#ffffff', 0, top + r * 0.35, 0))
      g.add(sphere(r * 1.15, '#ffffff', 0, top + r * 1.05, 0, 1, 0.7, 1))
      break
    case 'bucket':
      g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.15, r * 0.7, 16), color, 0, top + r * 0.2, 0))
      g.add(mesh(new THREE.CylinderGeometry(r * 1.55, r * 1.6, r * 0.08, 18), color, 0, top - r * 0.12, 0))
      break
    case 'scarf':
      // Khăn trùm đầu, chừa khoảng hở phía trước (+Z) cho khuôn mặt.
      {
        const scarf = mesh(new THREE.SphereGeometry(r * 1.13, 16, 10, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.62), color, 0, headY + r * 0.05, -r * 0.03)
        scarf.material = (scarf.material as THREE.MeshStandardMaterial).clone()
        ;(scarf.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
        g.add(scarf)
        // Phần khăn trên trán.
        g.add(mesh(new THREE.SphereGeometry(r * 1.14, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), color, 0, headY + r * 0.05, -r * 0.03))
      }
      g.add(sphere(r * 0.22, color, 0, headY - r * 0.55, -r * 0.95))
      break
  }
}
