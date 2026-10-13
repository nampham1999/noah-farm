import * as THREE from 'three'

export interface InstancedModel {
  group: THREE.Group
  /** Số bản sao đang hiện (≤ capacity). */
  setCount(n: number): void
  /** Đặt vị trí, hướng, tỉ lệ cho bản sao thứ i. */
  setMatrixAt(i: number, matrix: THREE.Matrix4): void
  /** Gọi sau khi đổi ma trận để GPU nhận dữ liệu mới. */
  commit(): void
}

/**
 * Vẽ nhiều bản sao của một mô hình glTF: mỗi mesh bên trong thành một InstancedMesh,
 * nên 100 cái cây vẫn chỉ tốn vài lần gọi vẽ (GDD mục 5.3).
 */
export function instanceModel(source: THREE.Object3D, capacity: number, opts: { shadows?: boolean } = {}): InstancedModel {
  const group = new THREE.Group()
  const parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = []

  source.updateMatrixWorld(true)
  const rootInverse = source.matrixWorld.clone().invert()
  source.traverse((o) => {
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
