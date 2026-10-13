import './style.css'
import * as THREE from 'three'
import { bus, type GameAction } from './core/events.ts'
import { createInitialState, type GameState } from './core/state.ts'
import { now } from './core/time.ts'
import { plotAt } from './core/world.ts'
import { balance } from './data/index.ts'
import { setLang, t } from './i18n/index.ts'
import { Input } from './input/input.ts'
import { attachKeyboard } from './input/keyboard.ts'
import { attachPointer } from './input/pointer.ts'
import { FollowCamera } from './render/camera.ts'
import { createFarmView } from './render/farm.ts'
import { createFarmer } from './render/models.ts'
import { pickGround } from './render/picking.ts'
import { AdaptiveQuality } from './render/quality.ts'
import { createWorld } from './render/scene.ts'
import { loadModels } from './render/assets.ts'
import { updateCrops } from './systems/farming.ts'
import { Interaction } from './systems/interaction.ts'
import { cameraRelative, movePlayer, WALK_SPEED } from './systems/movement.ts'
import { applyOfflineProgress } from './systems/offline.ts'
import { eat, speedMultiplier } from './systems/progress.ts'
import { AutoSaver } from './save/autosave.ts'
import { BrowserSaveStore, type SaveStore } from './save/SaveStore.ts'
import { formatDuration } from './ui/files.ts'
import { createHud } from './ui/hud.ts'
import { createInventoryPanel } from './ui/inventory.ts'
import { backupDue, createMenuPanel } from './ui/menu.ts'
import { closePanel, initPanels, isModalOpen, isPanelOpen, openPanel, togglePanel } from './ui/panel.ts'
import { showRecovery } from './ui/recovery.ts'
import { createShopPanel } from './ui/shop.ts'

/** Giới hạn bước thời gian để tab bị treo lâu không làm nhân vật nhảy xa. */
const MAX_DT = 0.1
/** Vắng lâu hơn mức này thì chào mừng trở lại. */
const WELCOME_BACK_MS = 5 * 60_000

async function start(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app')!
  const ui = document.querySelector<HTMLDivElement>('#ui')!

  // Ngôn ngữ theo trình duyệt cho tới khi đọc được cài đặt đã lưu.
  setLang(createInitialState().settings.lang)

  if (!supportsWebGL()) {
    ui.innerHTML = `<div class="fatal">${t('webgl.error')}</div>`
    return
  }

  initPanels(ui)
  const loading = showLoading(ui)
  const store = new BrowserSaveStore()
  // Tải mô hình song song với đọc bản lưu; hộp thoại khôi phục (nếu có) hiện trên màn hình tải.
  const modelsReady = loadModels(loading.progress)
  const { state, savedAt, isNew } = await loadGame(store)
  const models = await modelsReady.catch((e: unknown) => {
    loading.fail()
    throw e
  })
  loading.done()
  setLang(state.settings.lang)
  const offline = applyOfflineProgress(state, savedAt, now())

  const world = createWorld(app, models)
  const canvas = world.renderer.domElement
  const followCam = new FollowCamera(window.innerWidth / window.innerHeight)
  const quality = new AdaptiveQuality(world.renderer)
  const farmView = createFarmView(world.scene, models.crops)
  const farmer = createFarmer(models.farmer)
  world.scene.add(farmer.root)

  const autosaver = new AutoSaver(store, state)
  autosaver.start()
  if (isNew) void autosaver.saveNow()

  const shopPanel = createShopPanel(state)
  const menuPanel = createMenuPanel(state, store, autosaver)
  const inventoryPanel = createInventoryPanel(state)
  const interaction = new Interaction(state, { openShop: () => openPanel(shopPanel), now })

  const input = new Input()
  attachKeyboard(input)
  attachPointer(input, canvas, ui)
  followCam.zoom = state.settings.zoom
  const hud = createHud(ui, state, {
    eat: () => eat(state),
    openInventory: () => togglePanel(inventoryPanel),
    openMenu: () => togglePanel(menuPanel),
    backupDue: () => backupDue(state),
  })

  if (offline.elapsed > WELCOME_BACK_MS) {
    bus.emit('notify', { key: 'save.welcomeBack', params: { time: formatDuration(offline.elapsed) }, good: true })
  }
  if (offline.newlyRipe > 0) {
    bus.emit('notify', { key: 'save.ripeWhileAway', params: { n: offline.newlyRipe }, good: true })
  }
  if (backupDue(state)) bus.emit('notify', { key: 'save.remind' })

  bus.on('tap', ({ x, y }) => {
    if (isPanelOpen()) return
    const hit = pickGround(followCam.camera, x, y)
    if (hit) interaction.tapWorld(hit.x, hit.z, hit.onStall)
  })

  bus.on('selectSlot', (n) => {
    state.inventory.selected = n - 1
  })
  bus.on('cycleSlot', (d) => {
    const size = balance.toolbarSize
    state.inventory.selected = (state.inventory.selected + d + size) % size
  })

  const comingSoon = (action: GameAction) =>
    bus.emit('notify', { key: 'toast.comingSoon', params: { name: `action.${action}` } })

  bus.on('action', (action) => {
    if (isModalOpen()) return
    // Khi đang mở cửa sổ, chỉ cho đóng cửa sổ hoặc chuyển qua túi đồ.
    if (isPanelOpen() && action !== 'menu' && action !== 'inventory') return
    switch (action) {
      case 'useTool':
        return interaction.useFront()
      case 'interact':
        return interaction.interact()
      case 'eat':
        return eat(state)
      case 'inventory':
        return togglePanel(inventoryPanel)
      case 'menu':
        return isPanelOpen() ? closePanel() : openPanel(menuPanel)
      default:
        return comingSoon(action)
    }
  })

  window.addEventListener('resize', () => {
    world.renderer.setSize(window.innerWidth, window.innerHeight)
    followCam.resize(window.innerWidth / window.innerHeight)
  })

  // ?debug: mở trạng thái game cho DevTools và test tự động.
  if (new URLSearchParams(location.search).has('debug')) {
    const v = new THREE.Vector3()
    Object.assign(window, {
      cozy: {
        state,
        /** Toạ độ màn hình của một điểm trên mặt đất. */
        toScreen(x: number, z: number) {
          v.set(x, 0, z).project(followCam.camera)
          return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight }
        },
      },
    })
  }

  /** Ô đất dưới con trỏ chuột, nếu chuột vừa rê trong 2,5 giây (như bản cũ). */
  const hoveredPlot = () => {
    const h = input.hover
    if (!h || isPanelOpen() || performance.now() - h.at > 2500) return null
    const hit = pickGround(followCam.camera, h.x, h.y)
    const cell = hit && !hit.onStall ? plotAt(hit.x, hit.z) : null
    return cell ? interaction.plotAtCell(cell.x, cell.z) : null
  }

  const playerPos = new THREE.Vector3()
  const clock = new THREE.Timer()

  world.renderer.setAnimationLoop((time) => {
    clock.update(time)
    const dt = Math.min(clock.getDelta(), MAX_DT)

    updateCrops(state, now())

    // Tự điều khiển (WASD/joystick) thì huỷ việc tự đi tới chỗ đã chạm.
    const manual = isPanelOpen() ? { x: 0, y: 0 } : input.moveVector()
    let dir
    if (Math.hypot(manual.x, manual.y) > 0.05) {
      interaction.cancel()
      dir = cameraRelative(manual, followCam.yaw)
    } else {
      dir = interaction.autoWalk(dt)
    }
    const speed = movePlayer(state.player, dir, speedMultiplier(state), dt)

    playerPos.fromArray(state.player.pos)
    farmer.root.position.copy(playerPos)
    farmer.root.rotation.y = state.player.rotY
    farmer.animate(dt, Math.min(1, speed / WALK_SPEED))
    farmView.update(state, interaction.focusPlot(), clock.getElapsed())

    followCam.update(dt, playerPos, input.zoomScale)
    state.settings.zoom = followCam.zoom
    interaction.setHover(hoveredPlot())
    world.followShadow(playerPos)
    world.renderer.render(world.scene, followCam.camera)

    quality.tick(dt)
    hud.update(quality.fps, quality.pixelRatio)
    input.endFrame()
  })
}

/** Màn hình tải với thanh tiến trình, hiện trong lúc tải mô hình 3D. */
function showLoading(ui: HTMLElement): { progress(f: number): void; done(): void; fail(): void } {
  const el = document.createElement('div')
  el.className = 'loading'
  el.innerHTML = `<div class="loading__title">🌱 Cozy Farm</div><div class="loading__bar"><div class="loading__fill"></div></div><div class="loading__text"></div>`
  const fill = el.querySelector<HTMLElement>('.loading__fill')!
  const text = el.querySelector<HTMLElement>('.loading__text')!
  text.textContent = t('loading')
  ui.prepend(el)
  return {
    progress: (f) => (fill.style.width = `${Math.round(f * 100)}%`),
    done: () => {
      el.classList.add('is-done')
      setTimeout(() => el.remove(), 400)
    },
    fail: () => (text.textContent = t('loading.failed')),
  }
}

/** Đọc bản lưu; dữ liệu hỏng thì hỏi người chơi trước, không tự xoá (GDD mục 6.5). */
async function loadGame(store: SaveStore): Promise<{ state: GameState; savedAt: number; isNew: boolean }> {
  const result = await store.load().catch((e: unknown) => {
    console.error('Load failed', e)
    return { kind: 'broken', reason: 'invalid', hasBackup: false } as const
  })
  if (result.kind === 'ok') return { state: result.save.state, savedAt: result.save.savedAt, isNew: false }
  if (result.kind === 'broken') {
    const parsed = await showRecovery(store, result.reason, result.hasBackup)
    if (parsed) return { state: parsed.state, savedAt: parsed.savedAt, isNew: false }
  }
  return { state: createInitialState(), savedAt: 0, isNew: true }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

void start()
