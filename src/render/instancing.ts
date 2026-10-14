import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface InstancedModel {
  group: THREE.Group
  /** Số bản sao đang hiện (≤ capacity). */
  setCount(n: number): void
  /** Đặt vị trí, hướng, tỉ lệ cho bản sao thứ i. */
  setMatrixAt(i: number, matrix: THREE.Matrix4): void
  /** Gọi sau khi đổi ma trận để GPU nhận dữ liệu mới. */
  commit(): void
}

/** Vật liệu dùng chung cho mọi mô hình đã gộp màu vào đỉnh (xem bakeVertexColors). */
const BAKED_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })

const bakeCache = new WeakMap<THREE.Object3D, THREE.BufferGeometry | null>()

/**
 * Gộp cả mô hình thành một khối hình với màu nằm ở từng đỉnh, để cả mô hình chỉ tốn
 * một lần gọi vẽ thay vì mỗi vật liệu một lần (GDD mục 5.3: dưới khoảng 200 lần gọi vẽ).
 * Chỉ làm được với mô hình màu phẳng: trả về null nếu có texture, trong suốt, shader
 * riêng (gió) hay khung xương.
 */
export function bakeVertexColors(source: THREE.Object3D): THREE.BufferGeometry | null {
  if (bakeCache.has(source)) return bakeCache.get(source)!
  source.updateMatrixWorld(true)
  const rootInverse = source.matrixWorld.clone().invert()
  const parts: THREE.BufferGeometry[] = []
  let ok = true
  source.traverse((o) => {
    if (!ok || !(o instanceof THREE.Mesh)) return
    const m = o.material
    if (
      o instanceof THREE.SkinnedMesh || Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) ||
      m.map || m.transparent || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
    ) {
      ok = false
      return
    }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.applyMatrix4(rootInverse.clone().multiply(o.matrixWorld))
    const n = g.attributes.position.count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) m.color.toArray(colors, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(g)
  })
  const merged = ok && parts.length ? mergeGeometries(parts) : null
  bakeCache.set(source, merged)
  return merged
}

/** Bản sao tĩnh của mô hình: gộp màu được thì thành một mesh duy nhất, không thì giữ nguyên. */
export function staticModel(source: THREE.Object3D, shadows = true): THREE.Object3D {
  const geo = bakeVertexColors(source)
  if (!geo) return source.clone()
  const mesh = new THREE.Mesh(geo, BAKED_MATERIAL)
  mesh.castShadow = shadows
  mesh.receiveShadow = true
  return mesh
}

/** Bộ phận cử động được của con vật (chân, đuôi, cổ): giữ riêng để xoay; phần còn lại gộp làm thân. */
const MOVING_PART = /^[A-Za-z]+_(Leg_[A-Z]+|Tail|Neck)$/

const rigCache = new WeakMap<THREE.Object3D, THREE.Object3D>()

/**
 * Mô hình con vật gộp màu, ít lần vẽ: thân gộp một khối, mỗi bộ phận cử động
 * (chân, đuôi, cổ) gộp một khối riêng đặt trong nhóm xoay cùng tên với node gốc,
 * nên code hoạt ảnh vẫn tìm theo tên (vd. Dog_Leg_BL) như trước. Không gộp được
 * (vật liệu có texture...) thì trả về bản sao nguyên. Gọi nhiều lần trả về bản sao.
 */
export function riggedModel(source: THREE.Object3D): THREE.Object3D {
  let tpl = rigCache.get(source)
  if (!tpl) {
    tpl = buildRig(source) ?? source
    rigCache.set(source, tpl)
  }
  return tpl.clone()
}

function buildRig(source: THREE.Object3D): THREE.Object3D | null {
  source.updateMatrixWorld(true)
  const rootInverse = source.matrixWorld.clone().invert()
  const parts: THREE.Object3D[] = []
  source.traverse((o) => {
    if (o !== source && MOVING_PART.test(o.name) && !parts.some((p) => isInside(o, p))) parts.push(o)
  })
  const bake = (meshes: THREE.Mesh[], toLocal: THREE.Matrix4): THREE.BufferGeometry | null => {
    const geos: THREE.BufferGeometry[] = []
    for (const o of meshes) {
      const m = o.material
      if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || m.map || m.transparent || o instanceof THREE.SkinnedMesh) return null
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
      g.applyMatrix4(toLocal.clone().multiply(o.matrixWorld))
      const colors = new Float32Array(g.attributes.position.count * 3)
      for (let i = 0; i < g.attributes.position.count; i++) m.color.toArray(colors, i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geos.push(g)
    }
    return geos.length ? mergeGeometries(geos) : null
  }
  const meshesOf = (root: THREE.Object3D, skip: THREE.Object3D[]) => {
    const list: THREE.Mesh[] = []
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !skip.some((p) => isInside(o, p))) list.push(o)
    })
    return list
  }

  const rig = new THREE.Group()
  const body = bake(meshesOf(source, parts), rootInverse)
  if (!body) return null
  rig.add(shadowMesh(body))
  for (const part of parts) {
    const pivot = new THREE.Group()
    pivot.name = part.name
    rootInverse.clone().multiply(part.matrixWorld).decompose(pivot.position, pivot.quaternion, pivot.scale)
    const geo = bake(meshesOf(part, []), part.matrixWorld.clone().invert())
    if (!geo) return null
    pivot.add(shadowMesh(geo))
    rig.add(pivot)
  }
  return rig
}

function shadowMesh(geo: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, BAKED_MATERIAL)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function isInside(o: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancestor) return true
  return false
}

/**
 * Vẽ nhiều bản sao của một mô hình glTF bằng InstancedMesh, nên 100 cái cây vẫn chỉ tốn
 * vài lần gọi vẽ (GDD mục 5.3). Mô hình màu phẳng được gộp thành một khối duy nhất.
 */
export function instanceModel(source: THREE.Object3D, capacity: number, opts: { shadows?: boolean } = {}): InstancedModel {
  const group = new THREE.Group()
  const parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = []

  const baked = bakeVertexColors(source)
  if (baked) {
    const mesh = new THREE.InstancedMesh(baked, BAKED_MATERIAL, capacity)
    mesh.castShadow = opts.shadows ?? false
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.count = 0
    parts.push({ mesh, local: new THREE.Matrix4() })
    group.add(mesh)
  }

  source.updateMatrixWorld(true)
  const rootInverse = source.matrixWorld.clone().invert()
  if (!baked) source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, capacity)
    mesh.castShadow = opts.shadows ?? false
    mesh.receiveShadow = true
    // Khung bao thay đổi theo vị trí các bản sao; tắt cắt khung để khỏi mất hình.
    mesh.frustumCulled = false
    mesh.count = 0
    parts.push({ mesh, local: rootInverse.clone().multiply(o.matrixWorld) })
    group.add(mesh)
  })

  const m = new THREE.Matrix4()
  return {
    group,
    setCount(n) {
      for (const p of parts) p.mesh.count = Math.min(n, capacity)
    },
    setMatrixAt(i, matrix) {
      for (const p of parts) p.mesh.setMatrixAt(i, m.multiplyMatrices(matrix, p.local))
    },
    commit() {
      for (const p of parts) p.mesh.instanceMatrix.needsUpdate = true
    },
  }
}

/** Ma trận từ vị trí trên mặt đất, góc xoay quanh trục Y và tỉ lệ đều. */
export function placeMatrix(x: number, z: number, rotY = 0, scale = 1, y = 0, out = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY)
  return out.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale))
}
