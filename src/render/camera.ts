import * as THREE from 'three'

/** Độ lệch camera so với nhân vật ở zoom 1: nghiêng 45 độ, nhìn về phía -Z (giống bản cũ). */
const OFFSET = new THREE.Vector3(0, 10.5, 10.5)
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 2.45
const FOLLOW_RATE = 6
/** Góc nhìn dọc khi màn hình ngang hoặc vuông. */
const FOV = 45
/** Màn hình dọc: giữ góc nhìn ngang tối thiểu này để vẫn thấy đủ nông trại hai bên. */
const MIN_HORIZONTAL_FOV = 42
const MAX_FOV = 72
/** Màn hình dọc: kéo camera ra xa thêm tối đa chừng này lần để thấy rộng hơn. */
const MAX_PORTRAIT_PULLBACK = 1.35

/**
 * Camera góc nhìn thứ ba cố định 45 độ, không xoay, đi theo nhân vật mượt (GDD mục 4).
 * Góc cố định giúp hướng kéo trên màn hình trùng với hướng đi trong thế giới.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera
  /** Góc xoay của camera; cố định 0 (camera ở phía +Z). */
  readonly yaw = 0
  zoom = 1

  private readonly target = new THREE.Vector3()
  private initialized = false
  /** Hệ số kéo xa theo tỉ lệ màn hình; 1 khi màn hình ngang. */
  private pullback = 1

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 200)
    this.resize(aspect)
  }

  /** zoomScale lớn hơn 1 là kéo ra xa. */
  update(dt: number, follow: THREE.Vector3, zoomScale: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * zoomScale))

    if (this.initialized) {
      this.target.lerp(follow, 1 - Math.exp(-FOLLOW_RATE * dt))
    } else {
      this.target.copy(follow)
      this.initialized = true
    }

    this.camera.position.copy(this.target).addScaledVector(OFFSET, this.zoom * this.pullback)
    this.camera.lookAt(this.target)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.fov = fovFor(aspect)
    this.pullback = aspect < 1 ? Math.min(MAX_PORTRAIT_PULLBACK, 0.75 / aspect) : 1
    this.camera.updateProjectionMatrix()
  }
}

/**
 * Màn hình dọc thì mở rộng góc nhìn dọc, để góc nhìn ngang không nhỏ hơn MIN_HORIZONTAL_FOV;
 * nếu không, điện thoại cầm dọc chỉ thấy một dải hẹp quanh nhân vật.
 */
function fovFor(aspect: number): number {
  const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(MIN_HORIZONTAL_FOV / 2)) / aspect))
  return Math.min(MAX_FOV, Math.max(FOV, needed))
}
