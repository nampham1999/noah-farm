import type { Lang } from './state.ts'

/** Tên nông dân ngẫu nhiên cho người chơi mới (thay vì ai cũng một tên mặc định). */
const VI = {
  a: ['Cà Rốt', 'Bí Ngô', 'Dâu Tây', 'Gà Con', 'Ngô Non', 'Củ Cải', 'Hạt Đậu', 'Bắp Cải', 'Dưa Hấu', 'Vịt Bầu', 'Thỏ Nâu', 'Cún Con'],
  b: ['Vui Vẻ', 'Chăm Chỉ', 'Tí Hon', 'Lém Lỉnh', 'Hiền Hoà', 'Nhanh Nhẹn', 'Mũm Mĩm', 'Tinh Nghịch', 'Dễ Thương', 'Siêng Năng'],
}
const EN = {
  a: ['Happy', 'Busy', 'Tiny', 'Sunny', 'Lucky', 'Cheery', 'Sleepy', 'Brave', 'Jolly', 'Merry'],
  b: ['Carrot', 'Pumpkin', 'Turnip', 'Chick', 'Bean', 'Berry', 'Radish', 'Duckling', 'Bunny', 'Sprout'],
}

/** Tên tiếng Việt kiểu "Cà Rốt Vui Vẻ", tiếng Anh kiểu "Happy Carrot" (tối đa 20 ký tự). */
export function randomFarmerName(lang: Lang, rand = Math.random): string {
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]
  const name = lang === 'vi' ? `${pick(VI.a)} ${pick(VI.b)}` : `${pick(EN.a)} ${pick(EN.b)}`
  return name.slice(0, 20)
}

/** Tên mặc định cũ (trước khi có tên ngẫu nhiên): người chơi mang tên này được nhắc đặt tên. */
export const OLD_DEFAULT_NAME = 'Mia'
