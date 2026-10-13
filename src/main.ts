import './style.css'
import * as THREE from 'three'
import { bus, type GameAction } from './core/events.ts'
import { createInitialState, type GameState } from './core/state.ts'
import { now, TIME_SPEED } from './core/time.ts'
import { plotAt, roomCellAt } from './core/world.ts'
import { balance } from './data/index.ts'
import { setLang, t } from './i18n/index.ts'
import { Input } from './input/input.ts'
import { attachKeyboard } from './input/keyboard.ts'
import { attachPointer } from './input/pointer.ts'
import { FollowCamera } from './render/camera.ts'
import { createAnimalsView } from './render/animals.ts'
import { createFarmView } from './render/farm.ts'
import { createFishingView } from './render/fishing.ts'
import { createHouseView } from './render/house.ts'
import { atRoomDoor, blockedRects, enterHouse, exitHouse } from './systems/house.ts'
import { createDecorUi } from './ui/decorate.ts'
import { createJournalPanel } from './ui/journal.ts'
import { createSocialPanel } from './ui/social.ts'
import { decodeFarm } from './save/share.ts'
import { createBoardPanel, npcDialog } from './ui/orders.ts'
import { createNpcsView } from './render/npcs.ts'
import { npcPose, updateNpcs } from './systems/npcs.ts'
import { refillOrders } from './systems/orders.ts'
import { attachAudio } from './audio/index.ts'
import { sound } from './audio/sound.ts'
import { checkAchievements, ensureDaily, onProgress } from './systems/quests.ts'
import { createFarmer } from './render/models.ts'
import { pickGround } from './render/picking.ts'
import { AdaptiveQuality } from './render/quality.ts'
import { createWorld } from './render/scene.ts'
import { loadModels } from './render/assets.ts'
import { animalPose, animalsNewDay, updateAnimals, updateWander } from './systems/animals.ts'
import { advanceClock } from './systems/clock.ts'
import { fishing, isFishing, stop as stopFishing, strike, updateFishing } from './systems/fishing.ts'
import { createFishingUi } from './ui/fishing.ts'
import { dismount, mountable, RIDE_SPEED, ridingAnimal, toggleRide, updateRiding } from './systems/riding.ts'
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
  // Link #visit=…: đi dạo nông trại của bạn ở chế độ chỉ xem, không đụng tới bản lưu của mình.
  const visit = await readVisitLink()
  const visiting = visit !== null
  const { state, savedAt, isNew } = visit ? { state: visit, savedAt: 0, isNew: false } : await loadGame(store)
  if (!visiting && isNew) applyInvite(state)
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
  const animalsView = createAnimalsView(world.scene, models)
  const fishingView = createFishingView(world.scene)
  const windowModel = models.furniture.scene.getObjectByName('FurnRoot_room_window')?.clone() ?? null
  windowModel?.position.set(0, 0, 0)
  const houseView = createHouseView(world.scene, models.furniture, windowModel)
  const npcsView = createNpcsView(world.scene, models)

  const autosaver = new AutoSaver(store, state)
  if (visiting) autosaver.suspend()
  else {
    autosaver.start()
    if (isNew) void autosaver.saveNow()
  }

  const shopPanel = createShopPanel(state)
  const menuPanel = createMenuPanel(state, store, autosaver)
  const inventoryPanel = createInventoryPanel(state)
  const journalPanel = createJournalPanel(state)
  const audio = attachAudio(state)
  if (!visiting) {
    ensureDaily(state)
    refillOrders(state)
    bus.on('progress', (ev) => onProgress(state, ev))
  }
  const socialPanel = createSocialPanel(state)
  const goInside = () => {
    if (ridingAnimal()) dismount(state)
    if (isFishing()) stopFishing()
    enterHouse(state)
  }
  const boardPanel = createBoardPanel(state)
  const interaction = new Interaction(state, {
    openShop: () => openPanel(shopPanel),
    enterHouse: goInside,
    openNpc: (id) => openPanel(npcDialog(state, id)),
    openBoard: () => openPanel(boardPanel),
    now,
    readOnly: visiting,
  })

  const input = new Input()
  attachKeyboard(input)
  attachPointer(input, canvas, ui)
  followCam.zoom = state.settings.zoom
  const hud = createHud(ui, state, {
    eat: () => eat(state),
    openInventory: () => togglePanel(inventoryPanel),
    openMenu: () => togglePanel(menuPanel),
    backupDue: () => backupDue(state),
    rideState: () => (ridingAnimal() ? 'riding' : mountable(state) ? 'can' : 'none'),
    indoors: () => state.player.indoors,
    toggleDecor: () => decorUi.toggle(),
    openJournal: () => togglePanel(journalPanel),
    openSocial: () => togglePanel(socialPanel),
  })
  if (visiting) showVisitBanner(ui, state)
  const fishingUi = createFishingUi(ui, state)
  const decorUi = createDecorUi(ui, state)

  if (offline.elapsed > WELCOME_BACK_MS) {
    bus.emit('notify', { key: 'save.welcomeBack', params: { time: formatDuration(offline.elapsed) }, good: true })
  }
  if (offline.newlyRipe > 0) {
    bus.emit('notify', { key: 'save.ripeWhileAway', params: { n: offline.newlyRipe }, good: true })
  }
  if (backupDue(state)) bus.emit('notify', { key: 'save.remind' })

  bus.on('newDay', () => {
    animalsNewDay(state, now())
    ensureDaily(state)
    if (!visiting) refillOrders(state)
  })
  // Thành tựu không gắn với một việc cụ thể (cấp, đất, vật nuôi): kiểm tra định kỳ.
  if (!visiting) window.setInterval(() => checkAchievements(state), 5000)

  bus.on('tap', ({ x, y }) => {
    if (isPanelOpen()) return
    // Đang thăm: chỉ đi lại và vào xem nhà.
    if (visiting) {
      const hit = pickGround(followCam.camera, x, y)
      if (hit) interaction.tapWorld(hit.x, hit.z, false, hit.onHouse && !state.player.indoors)
      return
    }
    // Đang câu: chạm là giật cần (sớm quá thì thu cần).
    if (isFishing()) return strike(state)
    if (state.player.indoors) {
      const hit = pickGround(followCam.camera, x, y)
      if (!hit) return
      const cell = roomCellAt(hit.x, hit.z)
      if (decorUi.active) {
        if (cell) decorUi.tapCell(cell.cx, cell.cz)
        return
      }
      return interaction.tapWorld(hit.x, hit.z, false)
    }
    const npc = npcsView.hitTest(followCam.camera, x, y)
    if (npc) return interaction.tapNpc(npc)
    const animal = animalsView.hitTest(followCam.camera, x, y)
    if (animal) return interaction.tapAnimal(animal)
    const hit = pickGround(followCam.camera, x, y)
    if (hit?.onBoard) return interaction.tapBoard()
    if (hit) interaction.tapWorld(hit.x, hit.z, hit.onStall, hit.onHouse)
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
    if (visiting && action !== 'menu' && action !== 'interact') return
    // Khi đang mở cửa sổ, chỉ cho đóng cửa sổ hoặc chuyển qua túi đồ.
    if (isPanelOpen() && action !== 'menu' && action !== 'inventory' && action !== 'journal' && action !== 'social') return
    if (isFishing() && (action === 'useTool' || action === 'interact')) return strike(state)
    if (isFishing() && action === 'menu') return stopFishing()
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
      case 'journal':
        return togglePanel(journalPanel)
      case 'social':
        return togglePanel(socialPanel)
      case 'ride':
        return state.player.indoors ? undefined : toggleRide(state)
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
        /** Đồng hồ của game (đã tính ?speed). */
        now,
        fishing,
        sound,
        /** Toạ độ màn hình của một dân làng. */
        npcScreen(id: string) {
          const p = npcPose(id)
          return p ? this.toScreen(p.x, p.z) : null
        },
        /** Toạ độ màn hình của một con vật. */
        animalScreen(id: string) {
          const p = animalPose(id)
          return p ? this.toScreen(p.x, p.z) : null
        },
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
    return (cell && interaction.plotAtCell(cell.x, cell.z)) ?? null
  }

  const playerPos = new THREE.Vector3()
  const clock = new THREE.Timer()
  let lastT = now()

  world.renderer.setAnimationLoop((time) => {
    clock.update(time)
    const dt = Math.min(clock.getDelta(), MAX_DT)

    const t = now()
    advanceClock(state, dt * TIME_SPEED)
    updateCrops(state, t, lastT)
    updateAnimals(state, t, lastT)
    updateWander(state, dt, ridingAnimal())
    updateNpcs(state, dt)
    lastT = t

    // Tự điều khiển (WASD/joystick) thì huỷ việc tự đi tới chỗ đã chạm.
    const manual = isPanelOpen() ? { x: 0, y: 0 } : input.moveVector()
    updateFishing(state, dt)
    let dir
    if (Math.hypot(manual.x, manual.y) > 0.05) {
      interaction.cancel()
      // Tự đi thì thu cần.
      if (isFishing()) stopFishing()
      dir = cameraRelative(manual, followCam.yaw)
    } else if (isFishing()) {
      dir = { x: 0, z: 0 }
    } else {
      dir = interaction.autoWalk(dt)
    }
    const riding = ridingAnimal() !== null
    const speed = movePlayer(
      state.player, dir, speedMultiplier(state) * (riding ? RIDE_SPEED : 1), dt,
      state.player.indoors ? blockedRects(state) : [],
    )
    // Bước ra thảm cửa thì ra ngoài.
    if (state.player.indoors && atRoomDoor(state.player.pos[0], state.player.pos[2])) {
      interaction.cancel()
      decorUi.close()
      exitHouse(state)
    }
    updateRiding(state, Math.min(1, speed / (WALK_SPEED * RIDE_SPEED)))
    farmer.setRiding(riding)

    playerPos.fromArray(state.player.pos)
    farmer.root.position.copy(playerPos)
    farmer.root.rotation.y = state.player.rotY
    farmer.animate(dt, Math.min(1, speed / WALK_SPEED))
    farmView.update(state, interaction.focusPlot(), clock.getElapsed())
    animalsView.update(state, t, clock.getElapsed(), dt, ridingAnimal())
    npcsView.update(state, dt, clock.getElapsed())
    fishingView.update(state.player, clock.getElapsed())
    fishingUi.update()
    audio.update()
    houseView.update(state, decorUi.ghost, decorUi.active)
    decorUi.update()
    if (decorUi.active && input.hover) {
      const h = pickGround(followCam.camera, input.hover.x, input.hover.y)
      const cell = h && roomCellAt(h.x, h.z)
      if (cell) decorUi.hoverCell(cell.cx, cell.cz)
    }

    followCam.update(dt, playerPos, input.zoomScale)
    state.settings.zoom = followCam.zoom
    interaction.setHover(hoveredPlot())
    world.update(clock.getElapsed(), playerPos, state.clock, state.player.indoors)
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
  el.innerHTML = `<div class="loading__title">🌱 Noah Farm</div><div class="loading__bar"><div class="loading__fill"></div></div><div class="loading__text"></div>`
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

/** Đọc link thăm nông trại (#visit=…); null nếu không có hoặc link hỏng. */
async function readVisitLink(): Promise<GameState | null> {
  const m = /[#&]visit=([^&]+)/.exec(location.hash)
  if (!m) return null
  try {
    return await decodeFarm(decodeURIComponent(m[1]))
  } catch (e) {
    console.warn('Bad visit link', e)
    history.replaceState(null, '', location.pathname + location.search)
    setTimeout(() => bus.emit('notify', { key: 'visit.broken' }), 1500)
    return null
  }
}

/** Link mời ?ref=…: người mới bắt đầu từ link được tặng vàng một lần (GDD mục 8.2). */
const INVITE_GOLD = 500
function applyInvite(state: GameState): void {
  const params = new URLSearchParams(location.search)
  const ref = params.get('ref')
  if (!ref || ref === state.meta.inviteCode) return
  state.meta.referredBy = ref.slice(0, 16)
  state.player.gold += INVITE_GOLD
  setTimeout(() => bus.emit('notify', { key: 'invite.gift', params: { gold: INVITE_GOLD }, good: true }), 1500)
  params.delete('ref')
  const query = params.toString()
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash)
}

/** Dải báo "Đang thăm nông trại của …" và nút về nông trại của mình. */
function showVisitBanner(ui: HTMLElement, state: GameState): void {
  document.body.classList.add('is-visiting')
  const banner = document.createElement('div')
  banner.className = 'visit-banner'
  const text = document.createElement('span')
  text.textContent = t('visit.banner', { name: state.player.name, level: state.player.level })
  const home = document.createElement('button')
  home.className = 'btn small primary'
  home.textContent = t('visit.home')
  home.addEventListener('click', () => {
    location.href = location.pathname + location.search
  })
  banner.append(text, home)
  ui.append(banner)
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

/** Bản build: đăng ký service worker để cài ra màn hình chính và chơi offline (GDD mục 5.1). */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e: unknown) => console.warn('SW register failed', e))
  })
  // Có bản mới thay vào: báo người chơi, bản mới dùng từ lần mở sau.
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) bus.emit('notify', { key: 'pwa.updated', good: true })
    hadController = true
  })
}

// Dán link thăm vào thanh địa chỉ khi đang mở game: tải lại để vào chế độ thăm.
window.addEventListener('hashchange', () => {
  if (/[#&]visit=/.test(location.hash)) location.reload()
})

registerServiceWorker()
void start()
