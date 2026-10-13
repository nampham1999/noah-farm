import { getLang, t } from '../i18n/index.ts'

/** Cho trình duyệt tải về một file văn bản. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Mở hộp chọn file và đọc nội dung; null nếu người chơi huỷ. */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      resolve(file ? file.text() : null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Tên file sao lưu (GDD mục 6.6, đổi theo tên game): noahfarm-YYYYMMDD.json. */
export function backupFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `noahfarm-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`
}

/** Khoảng thời gian dạng ngắn gọn: "5 phút", "3 giờ", "2 ngày". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return t('time.minutes', { n: Math.max(1, minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('time.hours', { n: hours })
  return t('time.days', { n: Math.round(hours / 24) })
}

export function formatDateTime(ms: number, withDate = false): string {
  const locale = getLang() === 'vi' ? 'vi-VN' : 'en-US'
  return withDate
    ? new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
    : new Date(ms).toLocaleTimeString(locale)
}
