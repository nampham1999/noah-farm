import type { Engine, GameId } from './engine.ts'
import { mauBinh } from './mauBinh.ts'

export const ENGINES: Partial<Record<GameId, Engine>> = { mauBinh }
export const GAME_LIST: GameId[] = ['mauBinh']
