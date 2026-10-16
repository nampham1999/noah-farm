/**
 * Bộ bài 52 lá. Lá bài là số nguyên 0..51: id = hạng * 4 + chất.
 * Hạng theo thứ tự Tiến lên: 0=3, 1=4, …, 7=10, 8=J, 9=Q, 10=K, 11=A, 12=2.
 * Chất theo thứ tự Việt Nam: 0=♠ bích, 1=♣ tép, 2=♦ rô, 3=♥ cơ.
 */
export type Card = number

export const rankOf = (c: Card): number => c >> 2
export const suitOf = (c: Card): number => c & 3
export const isRed = (c: Card): boolean => suitOf(c) >= 2

const LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
export const SUIT_SYMBOLS = ['♠', '♣', '♦', '♥']

/** Hạng tự nhiên: A=1, 2=2, …, K=13 (cho Phỏm, Xì dách, Mậu binh). */
export const natural = (c: Card): number => ((rankOf(c) + 2) % 13) + 1

export const rankLabel = (c: Card): string => LABELS[rankOf(c)]
export const cardText = (c: Card): string => `${rankLabel(c)}${SUIT_SYMBOLS[suitOf(c)]}`

export function newDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i)
}

/** Xáo Fisher–Yates với bộ sinh số cho trước. */
export function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Sắp tăng dần theo hạng rồi chất (thứ tự Tiến lên). */
export const sortCards = (cards: Card[]): Card[] => cards.slice().sort((a, b) => a - b)
