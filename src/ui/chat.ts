import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { t, tKey } from '../i18n/index.ts'
import { CHAT_LEVEL, chat, markRead, MAX_CHARS, myUid, parseEvent, postWorld, sendDm, toggleBlock, unreadTotal, watchDm } from '../online/chat.ts'
import type { ChatMessage } from '../online/cloud.ts'
import { online } from '../online/online.ts'
import { openPanel, type PanelSpec } from './panel.ts'

/** Biểu cảm nhanh, bấm là gửi (dễ dùng trên điện thoại, an toàn cho trẻ nhỏ). */
const QUICK = ['👋', '😄', '❤️', '🌱', '🐔', '🎣', '👍', '🎉']

/** Nút 💬 nổi (góc trái, trên thanh công cụ), có chấm đỏ khi có tin riêng chưa đọc. */
export function attachChatButton(ui: HTMLElement, state: GameState): void {
  const btn = document.createElement('button')
  btn.className = 'round-btn chat-fab'
  btn.textContent = '💬'
  btn.title = t('chat.title')
  btn.hidden = true
  // Một cửa sổ dùng lại cho mọi lần mở (giữ thẻ đang xem và chữ đang gõ).
  const panel = chatPanel(state)
  btn.addEventListener('click', () => openPanel(panel))
  ui.append(btn)
  const update = () => {
    btn.hidden = online.status !== 'on' || document.body.classList.contains('is-visiting')
    btn.classList.toggle('has-badge', unreadTotal() > 0)
  }
  bus.on('onlineChanged', update)
  bus.on('chatChanged', update)
  update()
}

type View = { kind: 'world' } | { kind: 'friends' } | { kind: 'dm'; uid: string; name: string }

export function chatPanel(state: GameState): PanelSpec {
  let view: View = { kind: 'world' }
  let draft = ''
  let dmMessages: ChatMessage[] = []
  let stopDm: (() => void) | null = null
  let redraw: (() => void) | null = null
  let blockArm: string | null = null
  // Vẽ lại khi có tin mới (chỉ khi cửa sổ còn mở).
  const onChat = () => redraw?.()
  bus.on('chatChanged', onChat)

  const openDm = (uid: string, name: string) => {
    stopDm?.()
    dmMessages = []
    view = { kind: 'dm', uid, name }
    stopDm = watchDm(uid, (list) => {
      dmMessages = list
      markRead(uid)
      redraw?.()
    })
  }

  return {
    title: () => `💬 ${t('chat.title')}`,
    onClose: () => {
      stopDm?.()
      stopDm = null
      redraw = null
    },
    render(body, refresh) {
      redraw = refresh
      // Đang gõ mà có tin mới thì vẽ lại: giữ con trỏ trong ô nhập.
      const typing = document.activeElement?.classList.contains('chat-input') ?? false
      // Thẻ: Làng | Bạn bè (hoặc tên người đang nói chuyện).
      const tabs = document.createElement('div')
      tabs.className = 'tabs'
      const tab = (label: string, active: boolean, onClick: () => void, badge = false) => {
        const b = document.createElement('button')
        b.className = 'btn small tab' + (active ? ' is-active' : '') + (badge ? ' has-dot' : '')
        b.textContent = label
        b.addEventListener('click', onClick)
        tabs.append(b)
      }
      tab(`🏘️ ${t('chat.world')}`, view.kind === 'world', () => {
        stopDm?.()
        view = { kind: 'world' }
        refresh()
      })
      tab(`🤝 ${t('chat.friends')}`, view.kind !== 'world', () => {
        stopDm?.()
        view = { kind: 'friends' }
        refresh()
      }, unreadTotal() > 0)
      body.append(tabs)

      if (view.kind === 'friends') return renderFriends(body)
      const messages = view.kind === 'world' ? chat.world : dmMessages
      if (view.kind === 'dm') {
        const head = document.createElement('p')
        head.className = 'chat-with'
        head.textContent = t('chat.with', { name: view.name })
        body.append(head)
      }
      body.append(renderMessages(messages, view.kind === 'world'))
      body.append(renderInput(typing))
    },
  }

  function renderFriends(body: HTMLElement): void {
    if (online.friends.length === 0) {
      body.append(note(t('online.noFriends')))
      return
    }
    for (const f of online.friends) {
      const row = document.createElement('button')
      row.className = 'row chat-friend' + (chat.unread.has(f.uid) ? ' is-unread' : '')
      const head = chat.heads.get(f.uid)
      row.innerHTML = `<span class="row-icon"><span class="icon"><span class="emoji">🧑‍🌾</span></span></span><span class="row-main"><strong></strong><span class="muted"></span></span>`
      row.querySelector('strong')!.textContent = f.name
      row.querySelector('.muted')!.textContent = head ? head.lastText : t('chat.sayHi')
      row.addEventListener('click', () => {
        openDm(f.uid, f.name)
        redraw?.()
      })
      body.append(row)
    }
  }

  function renderMessages(list: ChatMessage[], world: boolean): HTMLElement {
    const box = document.createElement('div')
    box.className = 'chat-log'
    const me = myUid()
    const shown = list.filter((m) => !chat.blocked.has(m.uid))
    if (shown.length === 0) box.append(note(world ? t('chat.emptyWorld') : t('chat.emptyDm')))
    for (const m of shown) {
      if (m.kind === 'event') {
        const ev = parseEvent(m.text)
        const p = document.createElement('p')
        p.className = 'chat-event'
        p.textContent = tKey(ev.key, ev.params)
        box.append(p)
        continue
      }
      const mine = m.uid === me
      const msg = document.createElement('div')
      msg.className = 'chat-msg' + (mine ? ' is-mine' : '')
      if (!mine && world) {
        // Tên người gửi: bấm hai lần để chặn (như bản cũ).
        const who = document.createElement('button')
        who.className = 'chat-msg__who'
        who.textContent = blockArm === m.uid ? `🚫 ${t('chat.tapToBlock')}` : m.name
        who.addEventListener('click', () => {
          if (blockArm === m.uid) {
            toggleBlock(m.uid)
            blockArm = null
            bus.emit('notify', { key: 'chat.blocked', params: { name: m.name } })
          } else {
            blockArm = m.uid
          }
          redraw?.()
        })
        msg.append(who)
      }
      const text = document.createElement('span')
      text.className = 'chat-msg__text'
      text.textContent = m.text
      const time = document.createElement('span')
      time.className = 'chat-msg__time'
      time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      msg.append(text, time)
      box.append(msg)
    }
    // Cuộn xuống tin mới nhất.
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight))
    return box
  }

  function renderInput(focus: boolean): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'chat-compose'
    if (state.player.level < CHAT_LEVEL) {
      wrap.append(note(t('chat.needLevel', { level: CHAT_LEVEL })))
      return wrap
    }
    const quick = document.createElement('div')
    quick.className = 'chat-quick'
    for (const e of QUICK) {
      const b = document.createElement('button')
      b.className = 'chat-quick__btn'
      b.textContent = e
      b.addEventListener('click', () => void send(e))
      quick.append(b)
    }
    const row = document.createElement('div')
    row.className = 'chat-compose__row'
    const input = document.createElement('input')
    input.className = 'menu-input chat-input'
    input.maxLength = MAX_CHARS
    input.placeholder = view.kind === 'world' ? t('chat.placeholderWorld') : t('chat.placeholderDm')
    input.value = draft
    input.addEventListener('input', () => (draft = input.value))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void send(input.value)
    })
    const sendBtn = document.createElement('button')
    sendBtn.className = 'btn primary'
    sendBtn.textContent = t('chat.send')
    sendBtn.addEventListener('click', () => void send(input.value))
    row.append(input, sendBtn)
    wrap.append(quick, row)
    if (focus) requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return wrap
  }

  async function send(text: string): Promise<void> {
    const ok = view.kind === 'dm' ? await sendDm(state, view.uid, text) : view.kind === 'world' ? await postWorld(state, text) : false
    if (ok && text === draft) draft = ''
    redraw?.()
  }
}

function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'menu-note'
  p.textContent = text
  return p
}
