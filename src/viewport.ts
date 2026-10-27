/**
 * Khung nhìn ổn định trên điện thoại. Safari iOS thu nhỏ window.innerWidth/innerHeight khi trang bị phóng to
 * (chụm hai ngón, hoặc chạm đúp), nên canvas bị vẽ nhỏ lại, giao diện vỡ và không thu nhỏ trở lại được.
 * Ở đây: (1) innerWidth/innerHeight luôn trả về kích thước khung bố cục (không đổi theo mức phóng to) để canvas và
 * mọi phép tính toạ độ màn hình giữ nguyên, (2) trang đang bị phóng to thì tự đưa về mức 1.
 */

const vv = window.visualViewport

if (vv) {
  const layout = (visual: number) => Math.round(visual * vv.scale)
  try {
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => layout(vv.width) })
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => layout(vv.height) })
  } catch {
    // Trình duyệt không cho ghi đè: vẫn dùng kích thước gốc.
  }

  let resetting = false
  const resetZoom = () => {
    if (resetting || vv.scale <= 1.02) return
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return
    resetting = true
    const original = meta.content
    // Đổi nội dung thẻ viewport để trình duyệt tính lại mức phóng to, rồi trả lại như cũ.
    meta.content = 'width=device-width, initial-scale=1.0001, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    window.setTimeout(() => {
      meta.content = original
      resetting = false
      window.dispatchEvent(new Event('resize'))
    }, 120)
  }
  // Đợi người chơi nhấc tay khỏi màn hình rồi mới đưa về mức 1 (không giật giữa cử chỉ).
  let touching = 0
  window.addEventListener('touchstart', (e) => (touching = e.touches.length), { passive: true })
  window.addEventListener('touchend', (e) => {
    touching = e.touches.length
    if (!touching) window.setTimeout(resetZoom, 60)
  }, { passive: true })
  vv.addEventListener('resize', () => {
    if (!touching) resetZoom()
  })
  // Mở lại trang đã bị phóng to từ trước (trình duyệt nhớ mức phóng to): chữa ngay lúc tải.
  window.addEventListener('load', () => window.setTimeout(resetZoom, 300))
}
