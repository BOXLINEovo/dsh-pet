/**
 * 宠物素材总表：默认静止图 + 交互动画池。
 *
 * - 静止图：`node tools/anim-from-video.mjs --idle <立绘.png>`
 * - 新动画：`node tools/anim-from-video.mjs <视频> --name <名字> [--start 7 --duration 3 --pingpong]`
 *   生成后在此 import 并加入 {@link PET_ANIMS}，点击时会在池中随机挑一个播放。
 */
import { PET_IDLE } from './pet-idle.generated.ts'
import { ANIM_FPS as TURN_FPS, ANIM_FRAMES as TURN_FRAMES, ANIM_SRC as TURN_SRC } from './anim-turn.generated.ts'

export interface PetAnimation {
  /** 标识名（与 generated 文件名一致） */
  name: string
  /** WebP data URL */
  src: string
  /** 总帧数 */
  frames: number
  /** 帧率 */
  fps: number
  /** 一轮播放时长（毫秒） */
  duration: number
}

export { PET_IDLE }

/** 点击时随机播放的动画池 */
export const PET_ANIMS: PetAnimation[] = [
  {
    name: 'turn',
    src: TURN_SRC,
    frames: TURN_FRAMES,
    fps: TURN_FPS,
    duration: Math.round((TURN_FRAMES / TURN_FPS) * 1000),
  },
]
