import { bus } from '../core/events.ts'
import { tKey } from '../i18n/index.ts'
import { presence, sendEmote } from '../online/presence.ts'

const EMOJIS = ['👋', '❤️', '😂', '😮', '🎉', '👍', '🌱', '🐔']
const PHRASES = 6

/**
 * Nút 😊 (trên nút chat): bảng biểu cảm và câu nói nhanh, hiện thành bong bóng trên đầu
 * nhân vật cho mọi người cùng nông trại thấy. Chỉ hiện khi đang ở trong phòng (online).
 */
export function attachEmoteButton(ui: HTMLElement, onEmote: (e: string) => void): void {
  const btn = document.createElement('button')
  btn.className = 'round-btn emote-fab'
  btn.textContent = '😊'
  btn.hidden = true
  const pop = document.createElement('div')
  pop.className = 'emote-pop'
  pop.hidden = true
  ui.append(btn, pop)

  const fill = () => {
    pop.replaceChildren()
    const send = (e: string) => {
      sendEmote(e)
      onEmote(e)
      pop.hidden = true
    }
    const row = document.createElement('div')
    row.className = 'emote-pop__row'
    for (const e of EMOJIS) {
      const b = document.createElement('button')
      b.className = 'chat-quick__btn'
      b.textContent = e
      b.addEventListener('click', () => send(e))
      row.append(b)
    }
    pop.append(row)
    for (let i = 1; i <= PHRASES; i++) {
      const text = tKey(`emote.p${i}`)
      const b = document.createElement('button')
      b.className = 'btn small emote-pop__phrase'
      b.textContent = text
      b.addEventListener('click', () => send(text))
      pop.append(b)
    }
  }
  btn.addEventListener('click', () => {
    if (pop.hidden) fill()
    pop.hidden = !pop.hidden
  })
  const update = () => {
    btn.hidden = presence.room === null
    if (btn.hidden) pop.hidden = true
  }
  bus.on('presenceChanged', update)
  update()
}
