import type { Engine, GameId } from './engine.ts'
import { mauBinh } from './mauBinh.ts'
import { tienLen } from './tienLen.ts'

export const ENGINES: Partial<Record<GameId, Engine>> = { mauBinh, tienLen }
export const GAME_LIST: GameId[] = ['mauBinh', 'tienLen']
