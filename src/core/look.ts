/**
 * Ngoại hình nhân vật chibi (dân làng và nhân vật tự tạo của người chơi).
 * Tách khỏi bộ dựng 3D để phần lưu game kiểm tra được mà không cần nạp three.js.
 */
export interface Look {
  body: 'male' | 'female'
  age: 'child' | 'adult' | 'elder'
  skin: string
  hair: string
  hairStyle: 'short' | 'long' | 'bun' | 'ponytail' | 'curly' | 'bald'
  beard?: 'full' | 'mustache'
  shirt: string
  pants: string
  /** Mặc váy (thay cho quần, chân thò dưới váy). */
  dress?: boolean
  shoes?: string
  hat?: 'straw' | 'cap' | 'chef' | 'bucket' | 'scarf'
  hatColor?: string
  apron?: string
  glasses?: boolean
  /** Người già chống gậy. */
  cane?: boolean
}

export const BODIES: Look['body'][] = ['male', 'female']
export const AGES: Look['age'][] = ['child', 'adult', 'elder']
export const HAIR_STYLES: Look['hairStyle'][] = ['short', 'long', 'bun', 'ponytail', 'curly', 'bald']
export const BEARDS: NonNullable<Look['beard']>[] = ['full', 'mustache']
export const HATS: NonNullable<Look['hat']>[] = ['straw', 'cap', 'bucket', 'chef', 'scarf']

/** Bảng màu cho người chơi chọn. */
export const PALETTE = {
  skin: ['#f6d7b8', '#f2c9a0', '#e0ac7e', '#c68a5e', '#9c6644', '#6e4630'],
  hair: ['#2b211c', '#5a3a24', '#8a5a2f', '#d9a441', '#c9472f', '#d8d4cc', '#f2f0ea'],
  cloth: ['#e0704a', '#e2483a', '#f2c75c', '#7cb342', '#3f8f6b', '#4a90d9', '#3d5a99', '#8e6cc9', '#e88fb0', '#f4efe2', '#6b5444', '#3a3a40'],
}

export const DEFAULT_LOOK: Look = {
  body: 'male',
  age: 'adult',
  skin: '#f2c9a0',
  hair: '#5a3a24',
  hairStyle: 'short',
  shirt: '#7cb342',
  pants: '#3d5a99',
  hat: 'straw',
  hatColor: '#f2c75c',
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

export function randomLook(): Look {
  const body = pick(BODIES)
  const age = pick(AGES)
  const look: Look = {
    body,
    age,
    skin: pick(PALETTE.skin),
    hair: age === 'elder' ? pick(['#d8d4cc', '#f2f0ea', '#8a8580']) : pick(PALETTE.hair),
    hairStyle: pick(body === 'female' ? (['long', 'bun', 'ponytail', 'curly'] as const) : (['short', 'curly', 'short', 'bald'] as const)),
    shirt: pick(PALETTE.cloth),
    pants: pick(PALETTE.cloth),
  }
  if (body === 'female' && Math.random() < 0.4) look.dress = true
  if (body === 'male' && age !== 'child' && Math.random() < 0.35) look.beard = pick(BEARDS)
  if (Math.random() < 0.5) {
    look.hat = pick(HATS)
    look.hatColor = pick(PALETTE.cloth)
  }
  if (Math.random() < 0.2) look.glasses = true
  if (age === 'elder' && Math.random() < 0.5) look.cane = true
  return look
}

const COLOR = /^#[0-9a-f]{6}$/i

/** Kiểm tra ngoại hình đọc từ file lưu; sai hoặc thiếu thì trả về null (dùng mẫu gốc). */
export function normalizeLook(v: unknown): Look | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const oneOf = <T>(x: unknown, list: readonly T[]): T | undefined => (list.includes(x as T) ? (x as T) : undefined)
  const color = (x: unknown) => (typeof x === 'string' && COLOR.test(x) ? x : undefined)
  const body = oneOf(o.body, BODIES)
  const age = oneOf(o.age, AGES)
  const skin = color(o.skin)
  const hair = color(o.hair)
  const hairStyle = oneOf(o.hairStyle, HAIR_STYLES)
  const shirt = color(o.shirt)
  const pants = color(o.pants)
  if (!body || !age || !skin || !hair || !hairStyle || !shirt || !pants) return null
  const look: Look = { body, age, skin, hair, hairStyle, shirt, pants }
  const beard = oneOf(o.beard, BEARDS)
  if (beard) look.beard = beard
  const hat = oneOf(o.hat, HATS)
  if (hat) look.hat = hat
  const hatColor = color(o.hatColor)
  if (hatColor) look.hatColor = hatColor
  const shoes = color(o.shoes)
  if (shoes) look.shoes = shoes
  const apron = color(o.apron)
  if (apron) look.apron = apron
  if (o.dress === true) look.dress = true
  if (o.glasses === true) look.glasses = true
  if (o.cane === true) look.cane = true
  return look
}
