import './style.css'
import * as THREE from 'three'
import type { Season, Weather } from './core/state.ts'
import { addItem, countItem } from './systems/inventory.ts'
import { blockPlots, greenhousePlots } from './core/state.ts'
import { ANIMAL_BY_ID, animalData, CROPS, DAY_MS, FRUIT_TREES, MACHINES, ORCHARD, type AnimalType } from './data/index.ts'
import { inGreenhouse, LAND_BLOCKS, ROOM_SIZES } from './core/world.ts'
import { NPCS } from './systems/orders.ts'
import { applyWeather, setWeather, WEATHERS } from './systems/weather.ts'
import { collect, machineStatus, updateMachines } from './systems/machines.ts'
import { createMachinesView } from './render/machines.ts'
import { setRoomSize } from './core/world.ts'
import { createPetView } from './render/pet.ts'
import { createGreenhouseView } from './render/greenhouse.ts'
import { petNewDay, updatePet } from './systems/pet.ts'
import { machinePanel } from './ui/machines.ts'
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
import { createHouseView, type HouseView } from './render/house.ts'
import { atRoomDoor, blockedRects, enterHouse, exitHouse } from './systems/house.ts'
import { createDecorUi } from './ui/decorate.ts'
import { createJournalPanel } from './ui/journal.ts'
import { createCharacterPanel } from './ui/character.ts'
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
import { createCharacter } from './render/character.ts'
import { initTools, type ActionName } from './render/tools.ts'
import { pickGround } from './render/picking.ts'
import { AdaptiveQuality } from './render/quality.ts'
import { createWorld } from './render/scene.ts'
import { loadFurniture, loadModels } from './render/assets.ts'
import { animalPose, animalsNewDay, updateAnimals, updateWander } from './systems/animals.ts'
import { advanceClock, SEASONS } from './systems/clock.ts'
import { fishing, isFishing, stop as stopFishing, strike, updateFishing } from './systems/fishing.ts'
import { createFishingUi } from './ui/fishing.ts'
import { canRide, dismount, HORSE_ID, rideSpeed, ridingAnimal, toggleRide, updateRiding } from './systems/riding.ts'
import { createHorseView } from './render/horse.ts'
import { createOrchardView } from './render/orchard.ts'
import { createFestivalView } from './render/festival.ts'
import { createFoxView } from './render/fox.ts'
import { renderPortrait } from './render/portrait.ts'
import { attachNotifications } from './systems/notifications.ts'
import { loadFriendFarm, sendHelp, startOnline } from './online/online.ts'
import { askUseCloud } from './ui/online.ts'
import { fox, scareFox, updateFox } from './systems/fox.ts'
import { festivalNewDay, onFestivalProgress } from './systems/festival.ts'
import { onFriendProgress } from './systems/friendship.ts'
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
  if (!visiting) applyTestParams(state)

  const world = createWorld(app, models)
  const canvas = world.renderer.domElement
  const followCam = new FollowCamera(window.innerWidth / window.innerHeight)
  const quality = new AdaptiveQuality(world.renderer)
  const farmView = createFarmView(world.scene, models.crops)
  initTools(models.tools)
  // Nhân vật người chơi: tự tạo (bộ dựng chibi) hoặc mẫu gốc của bản cũ.
  const makePlayerModel = () => (state.player.look ? createCharacter(state.player.look) : createFarmer(models.farmer))
  let farmer = makePlayerModel()
  world.scene.add(farmer.root)
  bus.on('lookChanged', () => {
    world.scene.remove(farmer.root)
    farmer = makePlayerModel()
    world.scene.add(farmer.root)
  })

  // Động tác làm việc theo việc vừa làm (cầm dụng cụ tương ứng trên tay).
  const PROGRESS_ACTION: Partial<Record<string, ActionName>> = {
    till: 'hoe', plant: 'plant', water: 'water', harvest: 'harvest', collect: 'harvest', fish: 'cheer',
  }
  bus.on('progress', (ev) => {
    const a = PROGRESS_ACTION[ev.type]
    if (a) farmer.playAction?.(a)
  })
  bus.on('levelUp', () => farmer.playAction?.('cheer'))
  bus.on('sfx', (name) => {
    if (name === 'chicken' || name === 'cow' || name === 'pig') farmer.playAction?.('pet')
  })
  let lastFishPhase = 'idle'
  const rodTip = new THREE.Vector3()
  const animalsView = createAnimalsView(world.scene, models)
  const machinesView = createMachinesView(world.scene, models)
  // Cấp nhà: phòng trong nhà và mô hình nhà bên ngoài.
  setRoomSize(state.house.level)
  world.setHouseLevel(state.house.level)
  bus.on('houseUpgraded', (level) => world.setHouseLevel(level))
  const petView = createPetView(world.scene, models)
  const greenhouseView = createGreenhouseView(world.scene, models)
  const horseView = createHorseView(world.scene, models)
  const orchardView = createOrchardView(world.scene, models)
  const festivalView = createFestivalView(world.scene)
  const foxView = createFoxView(world.scene, models)
  const fishingView = createFishingView(world.scene)
  // Trong nhà: nội thất chỉ tải khi vào nhà lần đầu.
  let houseView: HouseView | null = null
  let houseLoading = false
  const ensureHouseView = () => {
    if (houseView || houseLoading) return
    houseLoading = true
    void loadFurniture().then((furniture) => {
      const windowModel = furniture.scene.getObjectByName('FurnRoot_room_window')?.clone() ?? null
      windowModel?.position.set(0, 0, 0)
      houseView = createHouseView(world.scene, furniture, windowModel)
    })
  }
  if (state.player.indoors) ensureHouseView()

  // Tiết kiệm pin (GDD mục 4): 30 FPS, độ phân giải tối đa 1, không bóng đổ, bớt cỏ hoa.
  const applyQuality = () => {
    const low = state.settings.quality === 'low'
    world.setLowPower(low)
    quality.setTarget(low ? 30 : 60, low ? 1 : 2)
  }
  applyQuality()
  bus.on('qualityChanged', applyQuality)
  const npcsView = createNpcsView(world.scene, models)

  const autosaver = new AutoSaver(store, state)
  if (visiting) autosaver.suspend()
  else {
    autosaver.start()
    if (isNew) void autosaver.saveNow()
    // Chơi cùng bạn bè: lưu đám mây, mã bạn bè, hộp thư (mất mạng thì bỏ qua).
    void startOnline(state, store, autosaver, savedAt, askUseCloud)
  }

  const shopPanel = createShopPanel(state)
  const menuPanel = createMenuPanel(state, store, autosaver)
  const inventoryPanel = createInventoryPanel(state)
  const journalPanel = createJournalPanel(state)
  const audio = attachAudio(state)
  if (!visiting) attachNotifications(state)
  if (!visiting) {
    ensureDaily(state)
    refillOrders(state)
    bus.on('progress', (ev) => {
      onProgress(state, ev)
      onFestivalProgress(state, ev)
      onFriendProgress(state, ev)
    })
  }
  const socialPanel = createSocialPanel(state)
  const characterPanel = createCharacterPanel(state, () => autosaver.requestSoon(), () => (followCam.closeup = false))
  const goInside = () => {
    if (ridingAnimal()) dismount(state)
    if (isFishing()) stopFishing()
    ensureHouseView()
    enterHouse(state)
  }
  const boardPanel = createBoardPanel(state)
  const interaction = new Interaction(state, {
    openShop: () => openPanel(shopPanel),
    enterHouse: goInside,
    openNpc: (id) => openPanel(npcDialog(state, id)),
    openBoard: () => openPanel(boardPanel),
    openMachine: (id) => {
      if (machineStatus(state, id, now()) === 'ready') collect(state, id, now())
      else openPanel(machinePanel(state, id))
    },
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
    rideState: () => (ridingAnimal() ? 'riding' : canRide(state) ? 'can' : 'none'),
    indoors: () => state.player.indoors,
    toggleDecor: () => decorUi.toggle(),
    openJournal: () => togglePanel(journalPanel),
    openSocial: () => togglePanel(socialPanel),
  })
  // Avatar trên HUD: chân dung nhân vật tự tạo (mẫu gốc thì biểu tượng nông dân).
  const updatePortrait = () => hud.setPortrait(state.player.look ? renderPortrait(state.player.look) : null)
  updatePortrait()
  bus.on('lookChanged', updatePortrait)
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
    petNewDay(state)
    festivalNewDay(state)
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
    if (foxView.hitTest(followCam.camera, x, y)) return scareFox(state)
    if (petView.hitTest(followCam.camera, x, y)) return interaction.tapPet()
    if (!ridingAnimal() && horseView.hitTest(followCam.camera, x, y)) return interaction.tapHorse()
    const machine = machinesView.hitTest(followCam.camera, x, y)
    if (machine) return interaction.tapMachine(machine)
    const spot = orchardView.hitTest(followCam.camera, x, y)
    if (spot >= 0) return interaction.tapTree(spot)
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
    if (isPanelOpen() && action !== 'menu' && action !== 'inventory' && action !== 'journal' && action !== 'social' && action !== 'character') return
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
      case 'character':
        togglePanel(characterPanel)
        followCam.closeup = isPanelOpen()
        return
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
        /** Số lần gọi vẽ, tam giác, bộ nhớ GPU của khung hình gần nhất. */
        renderInfo() {
          const i = world.renderer.info
          return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, fps: Math.round(quality.fps), ratio: quality.pixelRatio }
        },
        npcPose,
        /** Cho nhân vật làm một động tác (để xem hoạt ảnh). */
        act: (name: ActionName) => farmer.playAction?.(name),
        setWeather: (w: Weather) => setWeather(state, w),
        fox,
        /** Dụng cụ đang cầm: kích thước thật trong thế giới (để kiểm tra tỉ lệ, hướng). */
        heldTool: () => {
          let info: { name: string; size: number[]; center: number[] } | null = null
          farmer.root.traverse((o) => {
            if (!info && o.name.startsWith('Tool_')) {
              const box = new THREE.Box3().setFromObject(o)
              info = { name: o.name, size: box.getSize(new THREE.Vector3()).toArray(), center: box.getCenter(new THREE.Vector3()).toArray() }
            }
          })
          return info
        },
        setLook: (look: unknown) => {
          state.player.look = look as typeof state.player.look
          bus.emit('lookChanged', undefined)
        },
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

  let lastFrame = 0
  world.renderer.setAnimationLoop((time) => {
    // Tiết kiệm pin: bỏ bớt khung hình để còn khoảng 30 FPS.
    if (state.settings.quality === 'low' && time - lastFrame < 1000 / 31) return
    lastFrame = time
    clock.update(time)
    const dt = Math.min(clock.getDelta(), MAX_DT)

    const t = now()
    advanceClock(state, dt * TIME_SPEED)
    if (!visiting) applyWeather(state, t)
    updateCrops(state, t, lastT)
    updateAnimals(state, t, lastT)
    updateMachines(state, t, lastT)
    updatePet(state, dt)
    if (!visiting) updateFox(state, dt)
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
      state.player, dir, speedMultiplier(state) * (riding ? rideSpeed() : 1), dt,
      state.player.indoors ? blockedRects(state) : [],
    )
    // Bước ra thảm cửa thì ra ngoài.
    if (state.player.indoors && atRoomDoor(state.player.pos[0], state.player.pos[2])) {
      interaction.cancel()
      decorUi.close()
      exitHouse(state)
    }
    updateRiding(state, Math.min(1, speed / (WALK_SPEED * rideSpeed())), dt)
    farmer.setRiding(riding, ridingAnimal() === HORSE_ID ? horseView.saddleY : undefined)

    playerPos.fromArray(state.player.pos)
    farmer.root.position.copy(playerPos)
    farmer.root.rotation.y = state.player.rotY
    farmer.animate(dt, Math.min(1, speed / WALK_SPEED))
    farmView.update(state, interaction.focusPlot(), clock.getElapsed())
    animalsView.update(state, t, clock.getElapsed(), dt, ridingAnimal())
    machinesView.update(state, t, clock.getElapsed())
    petView.update(state, clock.getElapsed())
    greenhouseView.update(state)
    horseView.update(state, clock.getElapsed(), dt)
    orchardView.update(state, t, clock.getElapsed())
    festivalView.update(state, clock.getElapsed())
    foxView.update(state, clock.getElapsed(), dt)
    npcsView.update(state, dt, clock.getElapsed())
    // Câu cá: quăng cần lúc thả, cầm cần chờ cá, rung cần lúc kéo.
    if (fishing.phase !== lastFishPhase) {
      if (fishing.phase === 'waiting' && lastFishPhase === 'idle') farmer.playAction?.('cast')
      farmer.setFishing?.(fishing.phase === 'idle' ? 'none' : fishing.phase === 'reeling' ? 'reel' : 'hold')
      lastFishPhase = fishing.phase
    }
    fishingView.update(state.player, clock.getElapsed(), farmer.rodTip?.(rodTip) ? rodTip : null)
    fishingUi.update()
    audio.update()
    houseView?.update(state, decorUi.ghost, decorUi.active)
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

/** Đang thăm nông trại một người bạn online (#friend=uid): để hiện nút tưới giúp. */
let visitFriend: { uid: string } | null = null

/** Đọc link thăm nông trại (#visit=… ảnh chụp, hoặc #friend=… bản mới nhất trên mây); null nếu không có hoặc hỏng. */
async function readVisitLink(): Promise<GameState | null> {
  const f = /[#&]friend=([^&]+)/.exec(location.hash)
  if (f) {
    try {
      const farm = await loadFriendFarm(decodeURIComponent(f[1]))
      if (farm) {
        visitFriend = { uid: decodeURIComponent(f[1]) }
        return farm
      }
    } catch (e) {
      console.warn('Friend farm failed', e)
    }
    history.replaceState(null, '', location.pathname + location.search)
    setTimeout(() => bus.emit('notify', { key: 'online.farmMissing' }), 1500)
    return null
  }
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
  banner.append(text)
  // Bạn online: tưới giúp mỗi ngày một lần (bạn nhận lúc vào game, mình được thưởng khi về nhà).
  if (visitFriend) {
    const friend = visitFriend
    const help = document.createElement('button')
    help.className = 'btn small'
    help.textContent = `💧 ${t('online.help')}`
    help.addEventListener('click', () => {
      help.disabled = true
      void sendHelp(myName(), friend.uid, state.player.name).then((ok) => {
        if (!ok) help.disabled = false
      })
    })
    banner.append(help)
  }
  banner.append(home)
  ui.append(banner)
}

/** Tên của mình (lúc đang thăm, trạng thái đang mở là của bạn): đọc từ bản lưu trên máy. */
function myName(): string {
  try {
    const raw = localStorage.getItem('cozyfarm.save.v1')
    const m = raw && /"name":"([^"]{1,20})"/.exec(raw)
    if (m) return m[1]
  } catch {
    // Không đọc được thì dùng tên chung.
  }
  return 'Noah'
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

/**
 * Tham số thử nghiệm trên link (để tự test nhanh các tính năng):
 * - ?max: mở hết và mua sẵn mọi thứ (ruộng, chuồng đầy vật nuôi, máy chế biến, chó, ngựa,
 *   nhà kính, nhà cấp 5, rào bãi thả, cây ăn quả đã lớn), cấp 10, 999.999 vàng, túi đủ nguyên liệu.
 * - &season=spring|summer|autumn|winter, &day=1..7 (ngày 4 là lễ hội), &time=0..23 (giờ), &weather=sunny|rain|storm|snow.
 */
function applyTestParams(state: GameState): void {
  const q = new URLSearchParams(location.search)
  const season = q.get('season')
  if (season && SEASONS.includes(season as Season)) state.clock.season = season as Season
  const day = Number(q.get('day'))
  if (day >= 1 && day <= balance.daysPerSeason) state.clock.day = Math.floor(day)
  const hour = Number(q.get('time'))
  if (q.has('time') && hour >= 0 && hour < 24) state.clock.minuteOfDay = hour * 60
  const weather = q.get('weather')
  if (weather && WEATHERS.includes(weather as Weather)) state.clock.weather = weather as Weather
  if (q.has('max')) maxOut(state)
  if ([...q.keys()].some((k) => ['max', 'season', 'day', 'time', 'weather'].includes(k))) {
    bus.emit('notify', { key: 'debug.testMode', good: true })
    bus.emit('saveRequest', undefined)
  }
}

/** ?max: mọi thứ ở mức đầy đủ nhất để thử. */
function maxOut(state: GameState): void {
  const t = now()
  const p = state.player
  p.level = 10
  p.xp = 0
  p.gold = 999_999
  p.stamina = balance.staminaMax

  // Ruộng: mở hết các khu, cuốc sẵn, trồng cây đúng mùa đã chín.
  while (state.landLevel < LAND_BLOCKS.length - 1) {
    state.landLevel++
    state.plots.push(...blockPlots(state.landLevel))
  }
  if (!state.greenhouse) {
    state.greenhouse = true
    state.plots.push(...greenhousePlots())
  }
  const seasonal = CROPS.filter((c) => c.seasons.includes(state.clock.season))
  state.plots.forEach((plot, i) => {
    plot.tilled = true
    if (plot.crop || inGreenhouse(plot.x, plot.z)) return
    plot.crop = seasonal[i % seasonal.length].id
    plot.stage = balance.cropStages
    plot.stageStartedAt = t
    plot.wateredAt = null
  })

  // Chuồng cấp cao nhất, đầy gà, lợn, bò (no, có sẵn sản phẩm; bò đã thuần để cưỡi).
  state.coopLevel = animalData.coopLevels.length
  state.coopFence = true
  const capacity = animalData.coopLevels[state.coopLevel - 1].capacity
  const mix: AnimalType[] = ['chicken', 'chicken', 'chicken', 'pig', 'pig', 'cow', 'cow', 'cow']
  for (let i = state.animals.length; i < capacity; i++) {
    const type = mix[i % mix.length]
    const def = ANIMAL_BY_ID.get(type)!
    state.animals.push({ id: `max${i}`, type, name: `${def.icon}${i + 1}`, fedAt: t, progress: def.cycleDays * DAY_MS, happiness: 100, pettedDay: -1, tamed: type === 'cow' })
  }

  // Máy chế biến (tổ ong có sẵn mật), chó, ngựa, nhà cấp 5.
  for (const m of MACHINES) {
    if (!state.machines.some((x) => x.id === m.id)) state.machines.push({ id: m.id, output: m.id === 'beehive' ? 'honey' : null, qty: m.id === 'beehive' ? 1 : 0, readyAt: t })
  }
  state.pet ??= { name: 'Lu', pettedDay: -1, gift: { id: 'gold', qty: 50 } }
  state.horse = true
  if (state.house.level < ROOM_SIZES.length) {
    state.house.level = ROOM_SIZES.length
    setRoomSize(state.house.level)
  }

  // Cây ăn quả đã lớn ở mọi ô vườn.
  ORCHARD.spots.forEach((_, spot) => {
    if (state.orchard.some((o) => o.spot === spot)) return
    state.orchard.push({ spot, type: FRUIT_TREES[spot % FRUIT_TREES.length].id, plantedAt: t - ORCHARD.growMinutes * 60_000, pickedAt: null })
  })

  // Dân làng 4 tim (tặng thêm một món là lên 5 tim, nhận thư).
  for (const npc of NPCS) state.friends[npc.id] = { points: 230, giftDay: -1, rewarded: 3 }

  // Túi: nguyên liệu để chế biến, tặng quà, trồng nhà kính.
  const items: [string, number][] = [
    ['egg', 20], ['milk', 10], ['honey', 5], ['fish_carp', 5], ['feed_hay', 30],
    ['crop_strawberry', 10], ['crop_pumpkin', 5], ['crop_corn', 10], ['crop_tomato', 5], ['crop_watermelon', 3],
    ['seed_tomato', 10], ['seed_pumpkin', 10], ['fruit_apple', 5],
    ['sapling_apple', 1], ['sapling_orange', 1], ['sapling_cherry', 1],
  ]
  for (const [id, qty] of items) {
    const have = countItem(state.inventory, id)
    if (have < qty) addItem(state.inventory, id, qty - have)
  }
}
