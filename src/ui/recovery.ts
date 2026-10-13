import { tKey, t } from '../i18n/index.ts'
import type { ParsedSave } from '../save/format.ts'
import type { SaveStore } from '../save/SaveStore.ts'
import { pickTextFile } from './files.ts'
import { saveErrorText } from './menu.ts'
import { closePanel, openPanel } from './panel.ts'

/**
 * Hộp thoại khi dữ liệu lưu bị hỏng (GDD mục 6.5): không xoá gì, cho người chơi chọn
 * dùng bản sao, nhập file, hoặc bắt đầu lại. Trả về null nếu chọn bắt đầu lại.
 */
export function showRecovery(store: SaveStore, reason: string, hasBackup: boolean): Promise<ParsedSave | null> {
  return new Promise((resolve) => {
    let error: string | null = null
    const done = (result: ParsedSave | null) => {
      closePanel()
      resolve(result)
    }

    openPanel({
      title: () => t('recovery.title'),
      modal: true,
      render(body, refresh) {
        const p = document.createElement('p')
        p.className = 'menu-status'
        p.textContent = t('recovery.body', { reason: tKey(`save.error.${reason}`) })
        body.append(p)

        const actions = document.createElement('div')
        actions.className = 'menu-actions menu-actions--column'
        const add = (label: string, className: string, onClick: () => Promise<void> | void) => {
          const b = document.createElement('button')
          b.className = className
          b.textContent = label
          b.addEventListener('click', () => void onClick())
          actions.append(b)
        }

        const attempt = async (load: () => Promise<ParsedSave | null>) => {
          try {
            const parsed = await load()
            if (parsed) done(parsed)
          } catch (e) {
            error = saveErrorText(e)
            refresh()
          }
        }

        if (hasBackup) {
          add(`🛟 ${t('recovery.restoreBackup')}`, 'btn primary', () => attempt(() => store.restoreBackup()))
        }
        add(`📂 ${t('recovery.importFile')}`, 'btn', () =>
          attempt(async () => {
            const text = await pickTextFile()
            return text === null ? null : store.replace(text)
          }),
        )
        add(`🌱 ${t('recovery.newGame')}`, 'btn', () => done(null))

        body.append(actions)
        if (error) {
          const warn = document.createElement('p')
          warn.className = 'menu-note menu-note--warn'
          warn.textContent = `⚠️ ${error}`
          body.append(warn)
        }
      },
    })
  })
}
