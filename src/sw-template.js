/* Service worker của Noah Farm (GDD mục 5.1: PWA chơi offline).
 * File này là mẫu; lúc build, vite.config.ts điền mã phiên bản và danh sách khung app rồi ghi ra dist/sw.js.
 * - Khung app (HTML, JS, CSS, icon) lưu sẵn khi cài.
 * - Mô hình 3D, âm thanh, font lưu lại lần đầu tải, lần sau lấy từ máy (cache-first).
 * - Trang HTML: lấy bản mới khi có mạng, mất mạng thì dùng bản đã lưu.
 */
const VERSION = '__VERSION__'
const SHELL = __SHELL__
const SHELL_CACHE = `noah-farm-shell-${VERSION}`
const ASSET_CACHE = 'noah-farm-assets-v1'
const scope = new URL(self.registration.scope)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new URL(p, scope).toString())))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === scope.origin

  // Trang chính: mạng trước, mất mạng thì bản đã lưu.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(new URL('./', scope).toString(), copy))
          return res
        })
        .catch(() => caches.match(new URL('./', scope).toString()).then((r) => r ?? caches.match(new URL('index.html', scope).toString()))),
    )
    return
  }

  // Mô hình, texture, font: lưu lần đầu, lần sau lấy từ máy.
  const isAsset = sameOrigin && url.pathname.startsWith(new URL('assets/', scope).pathname) && !/\.(js|css)$/.test(url.pathname)
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  if (isAsset || isFont) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // JS, CSS, icon (tên có mã hash): bản đã lưu trước, không có thì tải.
  if (sameOrigin) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
  }
})
