import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Sinh dist/sw.js từ src/sw-template.js sau khi build: liệt kê khung app cần lưu sẵn
 * (HTML, JS, CSS, icon, manifest) và gắn mã phiên bản theo nội dung để bản mới thay bản cũ.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'noah-farm-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (statSync(full).isDirectory()) walk(full)
          else files.push(relative(outDir, full).split('\\').join('/'))
        }
      }
      walk(outDir)
      const shell = files.filter(
        (f) => f === 'index.html' || f === 'manifest.webmanifest' || f.startsWith('icons/') || /^assets\/[^/]+\.(js|css)$/.test(f),
      )
      const hash = createHash('sha256')
      for (const f of shell) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const template = readFileSync('src/sw-template.js', 'utf8')
      writeFileSync(join(outDir, 'sw.js'), template.replaceAll('__VERSION__', version).replaceAll('__SHELL__', JSON.stringify(['./', ...shell])))
    },
  }
}

export default defineConfig({
  // Đường dẫn tương đối để chạy được cả ở gốc tên miền lẫn thư mục con (GitHub Pages).
  base: './',
  plugins: [serviceWorker()],
})
