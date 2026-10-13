import * as THREE from 'three'

/** Thời gian và vị trí nhân vật dùng chung cho mọi vật lay theo gió; cập nhật mỗi khung hình. */
export const windUniforms = {
  uTime: { value: 0 },
  uPlayer: { value: new THREE.Vector2(9999, 9999) },
}

export interface WindOptions {
  /** Biên độ lay ở ngọn (m). */
  strength: number
  /** Đổi chiều cao đỉnh (y trong mô hình) ra hệ số 0..1: h = y * heightScale + heightOffset. */
  heightScale: number
  heightOffset?: number
  /** Nhân vật đi qua thì cỏ rẽ ra chừng này (m); 0 để tắt. */
  push?: number
}

/**
 * Làm vật liệu lay theo gió (cách bản cũ làm với cỏ): gốc đứng yên, ngọn lắc theo sóng sin
 * lệch pha theo vị trí, và bị đẩy ra khi nhân vật đứng gần. Dùng được cho InstancedMesh.
 */
export function applyWind(material: THREE.Material, opts: WindOptions): THREE.Material {
  const { strength, heightScale, heightOffset = 0, push = 0 } = opts
  const f = (n: number) => n.toFixed(4)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime
    shader.uniforms.uPlayer = windUniforms.uPlayer
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec2 uPlayer;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wp = modelMatrix * mvPosition;
        float h = clamp(position.y * ${f(heightScale)} + ${f(heightOffset)}, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.23) + 0.4 * sin(uTime * 3.1 + wp.x * 1.3);
        wp.x += sway * ${f(strength)} * h;
        wp.z += sway * ${f(strength * 0.4)} * h;
        ${push > 0 ? `
        vec2 away = wp.xz - uPlayer;
        float dist = length(away);
        wp.xz += (away / max(dist, 0.001)) * ${f(push)} * h * (1.0 - smoothstep(0.15, 0.9, dist));` : ''}
        mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`)
  }
  // Mỗi cấu hình gió là một chương trình shader riêng.
  material.customProgramCacheKey = () => `wind-${strength}-${push}-${heightScale}-${heightOffset}`
  return material
}

/** Áp gió cho mọi mesh trong mô hình; vật liệu được nhân bản để không ảnh hưởng chỗ khác dùng chung. */
export function windify(root: THREE.Object3D, opts: WindOptions): THREE.Object3D {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => applyWind(m.clone(), opts))
        : applyWind(o.material.clone(), opts)
    }
  })
  return root
}
