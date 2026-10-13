import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { now } from '../core/time.ts'
import { getLang, setLang, t, tKey } from '../i18n/index.ts'
import type { AutoSaver } from '../save/autosave.ts'
import { decodeCode, encodeCode } from '../save/codec.ts'
import { SaveError } from '../save/format.ts'
import type { SaveStore } from '../save/SaveStore.ts'
import { backupFilename, downloadText, formatDateTime, pickTextFile } from './files.ts'
import type { PanelSpec } from './panel.ts'

/** Nhắc sao lưu sau mỗi 7 ngày chơi thật (GDD mục 6.6). */
const BACKUP_REMIND_MS = 7 * 24 * 60 * 60 * 1000
const CONFIRM_MS = 4000

export function backupDue(state: GameState): boolean {
  return Date.now() - (state.meta.lastBackupAt ?? state.meta.createdAt) > BACKUP_REMIND_MS
}

/** Safari trên iPhone/iPad, chưa được thêm vào màn hình chính. */
export function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

/** Thông điệp lỗi khi đọc file hoặc mã sao lưu. */
export function saveErrorText(e: unknown): string {
  return tKey(`save.error.${e instanceof SaveError ? e.reason : 'corrupt'}`)
}

/** Menu (Esc / nút ☰): ngôn ngữ, sao lưu và khôi phục, chơi lại từ đầu. */
export function createMenuPanel(state: GameState, store: SaveStore, autosaver: AutoSaver): PanelSpec {
  let code: string | null = null
  let error: string | null = null
  let confirmNewGame = false
  let confirmTimer = 0

  const markBackedUp = () => {
    state.meta.lastBackupAt = Date.now()
    autosaver.requestSoon()
  }

  /** Ghi đè bằng dữ liệu mới rồi tải lại trang để mọi thứ khởi động sạch. */
  const restoreFrom = async (text: string, refresh: () => void) => {
    try {
      await autosaver.saveNow()
      await store.replace(text)
      autosaver.suspend()
      bus.emit('notify', { key: 'save.imported', good: true })
      setTimeout(() => location.reload(), 600)
    } catch (e) {
      error = saveErrorText(e)
      refresh()
    }
  }

  return {
    title: () => t('menu.title'),
    render(body, refresh) {
      // Ngôn ngữ.
      const langRow = section(body, t('menu.language'))
      langRow.append(
        button(`🌐 ${t('menu.languageName')} → ${getLang() === 'vi' ? 'English' : 'Tiếng Việt'}`, 'btn', () => {
          state.settings.lang = getLang() === 'vi' ? 'en' : 'vi'
          setLang(state.settings.lang)
          bus.emit('langChanged', state.settings.lang)
          autosaver.requestSoon()
        }),
      )

      // Âm thanh: nhạc nền và hiệu ứng.
      const audioBox = section(body, t('menu.sound'))
      audioBox.append(
        slider(`🎵 ${t('menu.music')}`, state.settings.musicVolume, (v) => {
          state.settings.musicVolume = v
          bus.emit('volumeChanged', undefined)
          autosaver.requestSoon()
        }),
        slider(`🔔 ${t('menu.sfx')}`, state.settings.volume, (v) => {
          state.settings.volume = v
          bus.emit('volumeChanged', undefined)
          bus.emit('sfx', 'click')
          autosaver.requestSoon()
        }),
      )

      // Lưu trữ.
      const box = section(body, t('menu.storage'))
      const status = document.createElement('p')
      status.className = 'menu-status'
      status.textContent = [
        autosaver.lastSavedAt ? t('save.status', { time: formatDateTime(autosaver.lastSavedAt), where: store.location }) : t('save.notYet'),
        state.meta.lastBackupAt ? t('save.lastBackup', { date: formatDateTime(state.meta.lastBackupAt, true) }) : t('save.neverBackedUp'),
      ].join(' · ')
      box.append(status)

      if (backupDue(state)) box.append(note(t('save.remindShort'), 'menu-note menu-note--warn'))
      if (isIosBrowserTab()) box.append(note(t('save.iosTip'), 'menu-note'))

      const actions = document.createElement('div')
      actions.className = 'menu-actions'
      actions.append(
        button(`💾 ${t('save.exportFile')}`, 'btn primary', () => {
          markBackedUp()
          downloadText(backupFilename(), store.exportText(state, now()))
          refresh()
        }),
        button(`📂 ${t('save.importFile')}`, 'btn', async () => {
          const text = await pickTextFile()
          if (text !== null) await restoreFrom(text, refresh)
        }),
        button(`🔑 ${t('save.makeCode')}`, 'btn', async () => {
          markBackedUp()
          code = await encodeCode(store.exportText(state, now()))
          await navigator.clipboard?.writeText(code).then(
            () => bus.emit('notify', { key: 'save.codeCopied', good: true }),
            () => {},
          )
          refresh()
        }),
      )
      box.append(actions)

      if (code) {
        const out = document.createElement('textarea')
        out.className = 'menu-code'
        out.readOnly = true
        out.value = code
        out.addEventListener('focus', () => out.select())
        box.append(out, note(t('save.codeHint'), 'menu-note'))
      }

      const input = document.createElement('textarea')
      input.className = 'menu-code'
      input.placeholder = t('save.pasteCode')
      const restoreCode = button(`📥 ${t('save.importCode')}`, 'btn', async () => {
        if (!input.value.trim()) return
        try {
          await restoreFrom(await decodeCode(input.value), refresh)
        } catch (e) {
          error = saveErrorText(e)
          refresh()
        }
      })
      box.append(input, restoreCode)
      if (error) box.append(note(`⚠️ ${error}`, 'menu-note menu-note--warn'))

      // Chơi lại từ đầu: bấm hai lần để tránh bấm nhầm.
      const danger = section(body, '')
      danger.append(
        button(confirmNewGame ? `⚠️ ${t('save.newGameConfirm')}` : `🔄 ${t('save.newGame')}`, 'btn danger', async () => {
          if (!confirmNewGame) {
            confirmNewGame = true
            clearTimeout(confirmTimer)
            confirmTimer = window.setTimeout(() => {
              confirmNewGame = false
              refresh()
            }, CONFIRM_MS)
            return refresh()
          }
          await autosaver.saveNow()
          autosaver.suspend()
          await store.startFresh()
          location.reload()
        }),
      )
    },
  }
}

/** Thanh trượt 0..100% có nhãn. */
function slider(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const row = document.createElement('label')
  row.className = 'menu-slider'
  const text = document.createElement('span')
  text.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '100'
  input.value = String(Math.round(value * 100))
  input.addEventListener('input', () => onChange(Number(input.value) / 100))
  row.append(text, input)
  return row
}

function section(body: HTMLElement, title: string): HTMLElement {
  const el = document.createElement('section')
  el.className = 'menu-section'
  if (title) {
    const h = document.createElement('h3')
    h.textContent = title
    el.append(h)
  }
  body.append(el)
  return el
}

function note(text: string, className: string): HTMLElement {
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  return p
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
