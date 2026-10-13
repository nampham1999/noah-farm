/**
 * Đồng hồ thật dùng cho dấu thời gian (GDD mục 6.4).
 * Thêm ?speed=N vào URL để thời gian trôi nhanh gấp N lần khi thử chơi.
 */
const speed = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1)
const startReal = Date.now()

export function now(): number {
  return speed === 1 ? Date.now() : startReal + (Date.now() - startReal) * speed
}
