import * as THREE from 'three'

/** Độ lệch camera so với nhân vật ở zoom 1: nghiêng 45 độ, nhìn về phía -Z (giống bản cũ). */
const OFFSET = new THREE.Vector3(0, 10.5, 10.5)
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 2.45
const FOLLOW_RATE = 6
/** Tốc độ trượt zoom (càng lớn càng bám tay). */
const ZOOM_EASE = 14
/** Cận cảnh nhân vật (lúc tạo nhân vật): khoảng cách camera so với zoom 1, màn ngang và dọc. */
const CLOSEUP_ZOOM = { landscape: 0.42, portrait: 0.32 }
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
  /** Khoảng cách camera tới điểm nhìn (m) sau lần update gần nhất. */
  distance = OFFSET.length()
  /** Bật thì zoom sát nhân vật và đẩy nhân vật sang trái (màn ngang) hoặc lên trên (màn dọc), chừa chỗ cho cửa sổ. */
  closeup = false
  /** Khung cần thấy trọn (vd. cả căn phòng khi trang trí): camera nhìn vào tâm và lùi đủ xa; null thì theo nhân vật. */
  frame: { x: number; z: number; w: number; d: number } | null = null

  private frameT = 0
  private readonly frameCenter = new THREE.Vector3()

  private closeupT = 0
  private readonly shift = new THREE.Vector3()

  private readonly target = new THREE.Vector3()
  private initialized = false
  /** Hệ số kéo xa theo tỉ lệ màn hình; 1 khi màn hình ngang. */
  private pullback = 1

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 200)
    this.resize(aspect)
  }

  /** Mức zoom đang hiện, trượt dần về zoom (đích) cho mượt khi chụm ngón hay lăn chuột. */
  private shownZoom = 0

  /** zoomScale lớn hơn 1 là kéo ra xa. */
  update(dt: number, follow: THREE.Vector3, zoomScale: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * zoomScale))
    this.shownZoom = this.shownZoom ? this.shownZoom + (this.zoom - this.shownZoom) * Math.min(1, dt * ZOOM_EASE) : this.zoom

    if (this.initialized) {
      this.target.lerp(follow, 1 - Math.exp(-FOLLOW_RATE * dt))
    } else {
      this.target.copy(follow)
      this.initialized = true
    }

    // Chuyển mượt vào và ra khỏi cận cảnh.
    this.closeupT += ((this.closeup ? 1 : 0) - this.closeupT) * (1 - Math.exp(-8 * dt))
    const c = this.closeupT
    let dist = THREE.MathUtils.lerp(this.shownZoom * this.pullback, this.camera.aspect >= 1 ? CLOSEUP_ZOOM.landscape : CLOSEUP_ZOOM.portrait, c)
    // Khung cần thấy trọn: lùi vừa đủ để cả chiều ngang lẫn chiều sâu nằm gọn trong màn hình.
    this.frameT += ((this.frame ? 1 : 0) - this.frameT) * (1 - Math.exp(-6 * dt))
    if (this.frame) this.frameCenter.set(this.frame.x, 0, this.frame.z)
    if (this.frameT > 0.001) {
      const f = this.frame
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
      const fit = f ? Math.max((f.w + 2) / (2 * tanV * this.camera.aspect), ((f.d + 2) * Math.SQRT1_2) / (2 * tanV)) / OFFSET.length() : dist
      dist = THREE.MathUtils.lerp(dist, Math.max(dist, fit), this.frameT)
      this.target.lerp(this.frameCenter, this.frameT)
    }
    const d = OFFSET.length() * dist
    if (this.camera.aspect >= 1) this.shift.set(0.29 * d * c, 0, 0)
    else this.shift.set(0, 0, 0.47 * d * c)
    this.shift.add(this.target)
    this.camera.position.copy(this.shift).addScaledVector(OFFSET, dist)
    this.distance = OFFSET.length() * dist
    this.camera.lookAt(this.shift)
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
