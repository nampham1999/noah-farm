import type { Engine, GameId } from './engine.ts'
import { mauBinh } from './mauBinh.ts'
import { tienLen } from './tienLen.ts'
import { phom } from './phom.ts'
import { xiDach } from './xiDach.ts'

export const ENGINES: Partial<Record<GameId, Engine>> = { mauBinh, tienLen, xiDach, phom }
export const GAME_LIST: GameId[] = ['mauBinh', 'tienLen', 'xiDach', 'phom']
