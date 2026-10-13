import * as THREE from 'three'
import { mulberry32 } from '../core/random.ts'
import { DOCK, FISHING_HUT, POND, pondRadius } from '../core/world.ts'
import type { Models } from './assets.ts'
import { instanceModel, placeMatrix } from './instancing.ts'
import { windify } from './wind.ts'

export interface Pond {
  update(time: number): void
}

const SEGMENTS = 96
/** Mô hình KayKit rất nhỏ; phóng lên cho vừa cảnh (như bản cũ). */
const HEX_SCALE = 3.5

/**
 * Hồ cá: viền uốn lượn, mặt nước vẽ bằng shader (sâu dần vào giữa, gợn sóng, bọt sát bờ,
 * lấp lánh), bờ cát, hoa súng, lau sậy, đá, cầu gỗ, chòi câu, thuyền và bóng cá bơi.
 */
export function createPond(scene: THREE.Scene, models: Models): Pond {
  const shore = new THREE.Mesh(outline(1.0), new THREE.MeshStandardMaterial({ color: 0xead39c, roughness: 1 }))
  shore.position.y = 0.022
  shore.receiveShadow = true
  const wetSand = new THREE.Mesh(outline(0.35), new THREE.MeshStandardMaterial({ color: 0xc9a86b, roughness: 1 }))
  wetSand.position.y = 0.026
  wetSand.receiveShadow = true

  const waterMaterial = createWaterMaterial()
  const water = new THREE.Mesh(outline(0), waterMaterial)
  water.position.y = 0.04
  scene.add(shore, wetSand, water)

  const rand = mulberry32(42)
  const inPond = (minF: number, maxF: number) => {
    const a = rand() * Math.PI * 2
    const d = pondRadius(a) * (minF + rand() * (maxF - minF))
    return { x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d, a }
  }
  const nearDock = (p: { x: number; z: number }) =>
    p.x > DOCK.x0 - 1 && p.x < DOCK.x1 + 1.2 && Math.abs(p.z - DOCK.z) < DOCK.halfWidth + 1.4

  // Hoa súng nổi trên mặt nước.
  const lilies: THREE.Matrix4[][] = [[], []]
  for (let i = 0; i < 14; i++) {
    const p = inPond(0.25, 0.85)
    if (nearDock(p)) continue
    lilies[i % 2].push(placeMatrix(p.x, p.z, rand() * Math.PI * 2, HEX_SCALE * (0.5 + rand() * 0.35), 0.045))
  }
  // Lau sậy mọc sát bờ, lay theo gió.
  const reeds: THREE.Matrix4[][] = [[], []]
  for (let i = 0; i < 26; i++) {
    const p = inPond(0.86, 0.98)
    if (nearDock(p)) continue
    reeds[i % 2].push(placeMatrix(p.x, p.z, rand() * Math.PI * 2, HEX_SCALE * (0.65 + rand() * 0.35), 0.02))
  }
  // Đá quanh bờ.
  const rocks: THREE.Matrix4[] = []
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2
    const d = pondRadius(a) + 0.5 + rand() * 0.6
    const p = { x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d }
    if (nearDock(p) || Math.hypot(p.x - FISHING_HUT.x, p.z - FISHING_HUT.z) < 2.4) continue
    rocks.push(placeMatrix(p.x, p.z, rand() * Math.PI * 2, HEX_SCALE * (0.55 + rand() * 0.6)))
  }

  const addInstances = (source: THREE.Object3D, mats: THREE.Matrix4[], shadows: boolean) => {
    if (mats.length === 0) return
    const inst = instanceModel(source, mats.length, { shadows })
    mats.forEach((m, i) => inst.setMatrixAt(i, m))
    inst.setCount(mats.length)
    inst.commit()
    scene.add(inst.group)
  }
  addInstances(models.lilyA.scene, lilies[0], false)
  addInstances(models.lilyB.scene, lilies[1], false)
  const reedOpts = { strength: 0.18, heightScale: 4, push: 0.25 }
  addInstances(windify(models.reedA.scene.clone(), reedOpts), reeds[0], true)
  addInstances(windify(models.reedB.scene.clone(), reedOpts), reeds[1], true)
  addInstances(models.rockA.scene, rocks.filter((_, i) => i % 2 === 0), true)
  addInstances(models.rockC.scene, rocks.filter((_, i) => i % 2 === 1), true)

  scene.add(createDock())

  const hut = models.fishingHut.scene.clone()
  hut.position.set(FISHING_HUT.x, 0, FISHING_HUT.z)
  // Quay cửa chòi về phía cầu gỗ.
  hut.rotation.y = Math.atan2(DOCK.x0 - FISHING_HUT.x, DOCK.z - FISHING_HUT.z)
  scene.add(hut)

  const boat = models.boat.scene.clone()
  const boatBase = new THREE.Vector3(DOCK.x1 - 0.6, 0.12, DOCK.z + 1.7)
  boat.position.copy(boatBase)
  boat.rotation.y = 0.25
  boat.scale.setScalar(0.8)
  scene.add(boat)

  // Bóng cá bơi dưới mặt nước, mỗi con một vòng riêng.
  const fishMat = new THREE.MeshBasicMaterial({ color: 0x163f55, transparent: true, opacity: 0.35, depthWrite: false })
  const fishGeo = new THREE.SphereGeometry(0.22, 10, 6)
  fishGeo.scale(1, 0.15, 0.45)
  const tailGeo = new THREE.ConeGeometry(0.12, 0.25, 4)
  tailGeo.rotateZ(Math.PI / 2)
  tailGeo.scale(1, 0.15, 1)
  tailGeo.translate(0.3, 0, 0)
  const fish = Array.from({ length: 5 }, (_, i) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(fishGeo, fishMat)
    const tail = new THREE.Mesh(tailGeo, fishMat)
    g.add(body, tail)
    g.position.y = 0.05
    scene.add(g)
    return { g, tail, radius: 1.2 + (i % 3) * 0.9, speed: (0.25 + rand() * 0.2) * (i % 2 ? 1 : -1), phase: rand() * 6.28, cx: POND.x + (rand() - 0.5) * 2, cz: POND.z + (rand() - 0.5) * 2 }
  })

  return {
    update(time) {
      waterMaterial.uniforms.uTime.value = time
      boat.position.y = boatBase.y + Math.sin(time * 1.3) * 0.04
      boat.rotation.z = Math.sin(time * 1.1) * 0.03
      boat.rotation.x = Math.sin(time * 0.9 + 1) * 0.02
      for (const f of fish) {
        const a = f.phase + time * f.speed
        f.g.position.x = f.cx + Math.cos(a) * f.radius
        f.g.position.z = f.cz + Math.sin(a) * f.radius * 0.7
        // Đầu cá (phía -x của mô hình) hướng theo chiều bơi, tức đạo hàm của vị trí.
        const vx = -Math.sin(a) * f.radius * f.speed
        const vz = Math.cos(a) * f.radius * 0.7 * f.speed
        f.g.rotation.y = Math.atan2(vz, -vx)
        f.tail.rotation.y = Math.sin(time * 8 + f.phase) * 0.4
      }
    },
  }
}

/** Mặt phẳng theo viền hồ, nở rộng ra `grow` m (bờ cát dùng grow > 0). */
function outline(grow: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2
    const r = pondRadius(a) + grow
    // Shape nằm trên mặt XY; sau khi xoay -90° quanh X thì y của shape thành -z thế giới.
    const x = POND.x + Math.cos(a) * r
    const y = -(POND.z + Math.sin(a) * r)
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  const geo = new THREE.ShapeGeometry(shape, 1)
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** Mặt nước kiểu hoạt hình: màu theo độ sâu, gợn sóng, viền bọt và lấp lánh; có sương mù như cảnh. */
function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector2(POND.x, POND.z) },
        uBaseR: { value: POND.r },
        uDeep: { value: new THREE.Color(0x2f86c4) },
        uShallow: { value: new THREE.Color(0x6fd2e6) },
        uFoam: { value: new THREE.Color(0xf4fbff) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec2 uCenter;
      uniform float uBaseR;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      varying vec2 vWorld;

      // Cùng công thức với pondRadius() trong core/world.ts.
      float pondRadius(float a) {
        return uBaseR + 0.7 * sin(2.0 * a + 1.0) + 0.45 * sin(3.0 * a + 2.2) + 0.25 * sin(5.0 * a + 0.5);
      }

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main() {
        vec2 d = vWorld - uCenter;
        float edge = pondRadius(atan(d.y, d.x)) - length(d); // m tính từ bờ vào
        float depth = smoothstep(0.0, 3.2, edge);
        vec3 col = mix(uShallow, uDeep, depth);

        // Gợn sóng: hai lớp sóng chéo trôi chậm tạo vệt sáng.
        float w1 = sin(vWorld.x * 2.3 + uTime * 1.2 + sin(vWorld.y * 1.7 + uTime * 0.8));
        float w2 = sin(vWorld.y * 2.9 - uTime * 1.0 + sin(vWorld.x * 1.3 - uTime * 0.6));
        float ripple = smoothstep(0.82, 1.0, w1 * 0.5 + w2 * 0.5);
        col += ripple * 0.12;

        // Lấp lánh: điểm sáng nhấp nháy theo ô lưới nhỏ.
        vec2 cell = floor(vWorld * 3.0);
        float tw = hash(cell);
        float sparkle = step(0.985, tw) * (0.5 + 0.5 * sin(uTime * 4.0 + tw * 40.0));
        col += sparkle * 0.5 * depth;

        // Bọt sát bờ, mép lượn sóng theo thời gian.
        float foamEdge = 0.22 + 0.08 * sin(atan(d.y, d.x) * 18.0 + uTime * 2.0);
        float foam = 1.0 - smoothstep(foamEdge - 0.05, foamEdge + 0.05, edge);
        float foamRing = (1.0 - smoothstep(0.02, 0.06, abs(edge - 0.55 - 0.08 * sin(uTime * 1.5 + atan(d.y, d.x) * 7.0)))) * 0.35;
        col = mix(col, uFoam, max(foam, foamRing));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

/** Cầu gỗ: các tấm ván ngang trên hai thanh dầm và cọc. */
function createDock(): THREE.Group {
  const dock = new THREE.Group()
  const plankMat = new THREE.MeshStandardMaterial({ color: 0xb98550, roughness: 1 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1 })
  const length = DOCK.x1 - DOCK.x0
  const width = DOCK.halfWidth * 2
  const planks = Math.round(length / 0.32)
  const plankGeo = new THREE.BoxGeometry(0.28, 0.07, width)
  for (let i = 0; i < planks; i++) {
    const plank = new THREE.Mesh(plankGeo, i % 3 === 1 ? darkMat : plankMat)
    plank.position.set(DOCK.x0 + 0.16 + i * (length / planks), 0.26 + (i % 2) * 0.01, DOCK.z)
    plank.rotation.y = (i % 2 ? 1 : -1) * 0.015
    plank.castShadow = plank.receiveShadow = true
    dock.add(plank)
  }
  const beamGeo = new THREE.BoxGeometry(length, 0.08, 0.1)
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, darkMat)
    beam.position.set(DOCK.x0 + length / 2, 0.19, DOCK.z + side * (DOCK.halfWidth - 0.1))
    dock.add(beam)
  }
  const postGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.7, 6)
  for (const x of [DOCK.x0 + 1.2, DOCK.x0 + length / 2 + 0.6, DOCK.x1 - 0.1]) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, darkMat)
      post.position.set(x, 0.15, DOCK.z + side * (DOCK.halfWidth + 0.02))
      post.castShadow = true
      dock.add(post)
    }
  }
  return dock
}
