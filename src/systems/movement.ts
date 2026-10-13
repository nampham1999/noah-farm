import type { PlayerState } from '../core/state.ts'
import { FARM_HALF, isWater, OBSTACLES } from '../core/world.ts'

export const WALK_SPEED = 4.5
const PLAYER_RADIUS = 0.35
const TURN_RATE = 12
/** Đứng cách mép nước tối thiểu chừng này (âm là được bước hẳn ra mép bọt sóng). */
const SHORE_MARGIN = -0.15

export interface Dir {
  x: number
  z: number
}

/** Đổi hướng joystick/WASD (y dương là đi tới) sang hướng thế giới theo góc camera. */
export function cameraRelative(move: { x: number; y: number }, cameraYaw: number): Dir {
  const fx = -Math.sin(cameraYaw)
  const fz = -Math.cos(cameraYaw)
  const rx = Math.cos(cameraYaw)
  const rz = -Math.sin(cameraYaw)
  return { x: rx * move.x + fx * move.y, z: rz * move.x + fz * move.y }
}

/**
 * Di chuyển nhân vật theo hướng thế giới (độ dài tối đa 1), có va chạm với vật cản tròn
 * và hàng rào. Trả về tốc độ thực tế (m/s) để hoạt ảnh dùng.
 */
export function movePlayer(player: PlayerState, dir: Dir, speedMul: number, dt: number): number {
  if (Math.hypot(dir.x, dir.z) < 0.05) return 0

  const step = WALK_SPEED * speedMul * dt
  let x = player.pos[0] + dir.x * step
  let z = player.pos[2] + dir.z * step

  for (const o of OBSTACLES) {
    const ox = x - o.x
    const oz = z - o.z
    const minDist = o.r + PLAYER_RADIUS
    const dist = Math.hypot(ox, oz)
    if (dist < minDist && dist > 1e-6) {
      x = o.x + (ox / dist) * minDist
      z = o.z + (oz / dist) * minDist
    }
  }

  const limit = FARM_HALF - PLAYER_RADIUS - 0.2
  x = Math.min(limit, Math.max(-limit, x))
  z = Math.min(limit, Math.max(-limit, z))

  // Không lội xuống hồ: thử trượt theo từng trục để men theo bờ thay vì đứng khựng.
  if (isWater(x, z, SHORE_MARGIN)) {
    if (!isWater(x, player.pos[2], SHORE_MARGIN)) z = player.pos[2]
    else if (!isWater(player.pos[0], z, SHORE_MARGIN)) x = player.pos[0]
    else {
      x = player.pos[0]
      z = player.pos[2]
    }
  }

  const moved = Math.hypot(x - player.pos[0], z - player.pos[2])
  player.pos[0] = x
  player.pos[2] = z
  turnToward(player, dir.x, dir.z, Math.min(1, TURN_RATE * dt))

  return dt > 0 ? moved / dt : 0
}

/** Quay mặt về hướng (dx, dz) theo đường ngắn nhất; amount = 1 là quay ngay. */
export function turnToward(player: PlayerState, dx: number, dz: number, amount = 1): void {
  const targetRot = Math.atan2(dx, dz)
  const diff = Math.atan2(Math.sin(targetRot - player.rotY), Math.cos(targetRot - player.rotY))
  player.rotY += diff * amount
}
