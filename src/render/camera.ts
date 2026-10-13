import * as THREE from 'three'

/** Độ lệch camera so với nhân vật ở zoom 1: nghiêng 45 độ, nhìn về phía -Z (giống bản cũ). */
const OFFSET = new THREE.Vector3(0, 10.5, 10.5)
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 2.45
const FOLLOW_RATE = 6

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

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200)
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

    this.camera.position.copy(this.target).addScaledVector(OFFSET, this.zoom)
    this.camera.lookAt(this.target)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
