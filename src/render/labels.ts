import * as THREE from 'three'

/** Một bảng tên nổi: vị trí, chữ (đổi theo ngôn ngữ / trạng thái), và có hiện không. */
export interface LabelSpec {
  x: number
  y: number
  z: number
  text: () => string
  visible?: () => boolean
}

export interface LabelsView {
  update(player: THREE.Vector3, indoors: boolean, dt: number): void
}

/** Rõ khi lại gần (trong NEAR m), mờ dần tới FAR m thì ẩn hẳn, để nhìn xa không rối mắt. */
const NEAR = 7
const FAR = 15
/** Chiều cao bảng tên (m). */
const LABEL_H = 0.95
/** Kiểm tra chữ có đổi không (ngôn ngữ, trạng thái mua) mỗi chừng này giây. */
const TEXT_CHECK_S = 0.5

interface Label {
  spec: LabelSpec
  sprite: THREE.Sprite
  text: string
}

/** Bảng tên nổi (biểu tượng + chữ) trên các chỗ có chức năng: quầy hàng, nhà, chuồng, máy… */
export function createLabels(scene: THREE.Scene, specs: LabelSpec[]): LabelsView {
  const labels: Label[] = specs.map((spec) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }))
    sprite.position.set(spec.x, spec.y, spec.z)
    sprite.renderOrder = 5
    sprite.visible = false
    scene.add(sprite)
    return { spec, sprite, text: '' }
  })
  let check = 0

  return {
    update(player, indoors, dt) {
      check -= dt
      const recheck = check <= 0
      if (recheck) check = TEXT_CHECK_S
      for (const l of labels) {
        const shown = !indoors && (l.spec.visible?.() ?? true)
        const d = Math.hypot(player.x - l.spec.x, player.z - l.spec.z)
        const alpha = shown ? Math.min(1, Math.max(0, (FAR - d) / (FAR - NEAR))) : 0
        const mat = l.sprite.material as THREE.SpriteMaterial
        mat.opacity = alpha
        l.sprite.visible = alpha > 0.01
        if (l.sprite.visible && (recheck || !l.text)) {
          const text = l.spec.text()
          if (text !== l.text) {
            l.text = text
            mat.map?.dispose()
            const { texture, aspect } = labelTexture(text)
            mat.map = texture
            mat.needsUpdate = true
            l.sprite.scale.set(LABEL_H * aspect, LABEL_H, 1)
          }
        }
      }
    },
  }
}

/** Bảng gỗ bo tròn, chữ trắng viền nâu; trả về texture và tỉ lệ ngang/dọc để đặt cỡ sprite. */
function labelTexture(text: string): { texture: THREE.Texture; aspect: number } {
  const h = 96
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const font = 'bold 50px Fredoka, Nunito, sans-serif'
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 56
  c.width = w
  c.height = h
  g.font = font
  g.fillStyle = 'rgba(122, 68, 24, 0.92)'
  g.strokeStyle = '#4e2a0c'
  g.lineWidth = 6
  g.beginPath()
  g.roundRect(4, 8, w - 8, h - 16, 34)
  g.fill()
  g.stroke()
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fffaf0'
  g.fillText(text, w / 2, h / 2 + 2)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: w / h }
}
