import { bus } from '../core/events.ts'
import type { GameState } from '../core/state.ts'
import { dayPhase } from '../systems/clock.ts'
import { fishing, type FishingPhase } from '../systems/fishing.ts'
import { music } from './music.ts'
import { sound, type SfxName } from './sound.ts'

/** Việc nào kêu tiếng nào. */
const PROGRESS_SFX: Partial<Record<string, SfxName>> = {
  till: 'till', plant: 'plant', water: 'water', harvest: 'harvest', collect: 'harvest',
  sell: 'coin', fish: 'catch', place: 'place',
}

/** Thông báo nào kèm tiếng nào (thông báo khác thì im lặng). */
const NOTICE_SFX: Partial<Record<string, SfxName>> = {
  'quest.done': 'quest', 'quest.dailyDone': 'quest', 'quest.allDaily': 'levelUp', 'quest.tutorialDone': 'levelUp',
  'achievement.unlocked': 'levelUp', 'clock.newDay': 'newDay', 'fish.escaped': 'escape', 'fish.missed': 'escape',
  'animal.bought': 'coin', 'animal.coopBuilt': 'coin', 'animal.coopUpgraded': 'coin', 'house.bought': 'coin', 'house.upgraded': 'levelUp', 'greenhouse.built': 'levelUp', 'festival.done': 'levelUp', 'friend.heartUp': 'quest', 'friend.letter': 'levelUp', 'contest.win': 'levelUp', 'contest.teamFish': 'quest', 'land.bought': 'coin',
  'notice.noGold': 'error', 'notice.bagFull': 'error', 'notice.locked': 'error', 'decor.cantPlace': 'error',
  'animal.needHay': 'error', 'notice.noSeeds': 'error', 'fish.tooEarly': 'error',
}

export interface Audio {
  update(): void
}

/** Âm thanh của game: hiệu ứng theo sự kiện, nhạc nền theo giờ và nơi chốn. */
export function attachAudio(state: GameState): Audio {
  const applyVolumes = () => sound.setVolumes(state.settings.volume, state.settings.musicVolume)
  const unlock = () => {
    sound.unlock()
    applyVolumes()
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
  document.addEventListener('visibilitychange', () => sound.setSuspended(document.hidden))

  bus.on('progress', (ev) => {
    const name = PROGRESS_SFX[ev.type]
    if (name) sound.play(name)
  })
  bus.on('notify', (n) => {
    const name = NOTICE_SFX[n.key]
    if (name) sound.play(name)
  })
  bus.on('levelUp', () => sound.play('levelUp'))
  bus.on('sfx', (name) => sound.play(name as SfxName))
  bus.on('selectSlot', () => sound.play('click'))
  bus.on('cycleSlot', () => sound.play('click'))
  bus.on('volumeChanged', applyVolumes)

  let lastPhase: FishingPhase = 'idle'
  return {
    update() {
      if (fishing.phase !== lastPhase) {
        if (fishing.phase === 'waiting') sound.play('cast')
        if (fishing.phase === 'bite') sound.play('bite')
        lastPhase = fishing.phase
      }
      music.setCalm(state.player.indoors || dayPhase(state.clock.minuteOfDay) === 'night')
      // Tiếng mưa: trong nhà nghe nhỏ hơn.
      const w = state.clock.weather
      const rain = w === 'storm' ? 0.22 : w === 'rain' ? 0.13 : 0
      sound.setRain(state.player.indoors ? rain * 0.35 : rain)
      if (state.settings.musicVolume > 0) music.update()
    },
  }
}
