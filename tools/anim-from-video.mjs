/**
 * dsh-pet 动画素材管线：视频 → 逐帧抠底 → 透明动画 WebP → 内联资源模块。
 *
 *   node tools/anim-from-video.mjs <video> [--fps 12] [--width 340] [--bg auto]
 *                                      [--tolerance 45] [--quality 80] [--keep-frames]
 *
 * 步骤：
 *   1. ffmpeg 抽帧并按宽度缩放（PNG，保留 alpha 通道）
 *   2. 每帧从四边泛洪抠底（自动识别背景色；只去除与边缘连通的背景，角色内部同色区域保留）
 *   3. ffmpeg 合成透明动画 WebP（libwebp，支持 alpha）
 *   4. 写入 src/client/pet-art.generated.ts（data URL，客户端 <img> 直接播放）
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const video = args[0]
if (!video) {
  console.error('usage: node tools/anim-from-video.mjs <video> [--fps 12] [--width 340] [--bg auto|#RRGGBB|white|green]')
  console.error('                                       [--tolerance 45] [--quality 80] [--start 7] [--duration 3]')
  console.error('                                       [--pingpong] [--keep-frames]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const fps = Number(flag('fps', '12'))
const width = Number(flag('width', '340'))
const bgFlag = flag('bg', 'auto')
const tolerance = Number(flag('tolerance', '45'))
const quality = Number(flag('quality', '80'))
const start = flag('start', null)
const duration = flag('duration', null)
const pingpong = args.includes('--pingpong')
const keepFrames = args.includes('--keep-frames')

const framesDir = resolve('.anim-frames')
rmSync(framesDir, { recursive: true, force: true })
mkdirSync(framesDir, { recursive: true })

const trim = `${start !== null ? ` --start ${start}` : ''}${duration !== null ? ` --duration ${duration}` : ''}`
console.log(`[1/4] 抽帧: ${video}${trim} → ${fps}fps, ${width}px 宽`)
execFileSync(ffmpeg.path, [
  '-y',
  ...(start !== null ? ['-ss', String(start)] : []),
  '-i', resolve(video),
  ...(duration !== null ? ['-t', String(duration)] : []),
  '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
  '-pix_fmt', 'rgba',
  join(framesDir, 'f_%04d.png'),
], { stdio: ['ignore', 'ignore', 'pipe'] })

const frameFiles = readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort()
if (frameFiles.length === 0) throw new Error('没有抽到任何帧')
console.log(`      抽到 ${frameFiles.length} 帧`)

/** 解析 --bg 参数；auto 时取四角像素的多数色。 */
function resolveBackground(png, mode) {
  const named = { white: [255, 255, 255], green: [0, 255, 0], black: [0, 0, 0] }
  if (mode !== 'auto') {
    if (named[mode]) return named[mode]
    const m = /^#?([0-9a-f]{6})$/i.exec(mode)
    if (m) {
      const v = parseInt(m[1], 16)
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
    }
    throw new Error(`无法解析 --bg ${mode}`)
  }
  const corners = [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]]
  const counts = new Map()
  for (const [x, y] of corners) {
    const i = (png.width * y + x) << 2
    const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return best.split(',').map(Number)
}

/** 从四边泛洪抠底，边缘按色差羽化。 */
function removeBackground(png, bg, tolerance) {
  const { width: w, height: h, data } = png
  const diff = (i) => Math.max(
    Math.abs(data[i] - bg[0]),
    Math.abs(data[i + 1] - bg[1]),
    Math.abs(data[i + 2] - bg[2]),
  )
  const feather = Math.max(8, Math.round(tolerance * 0.4))
  const visited = new Uint8Array(w * h)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const idx = y * w + x
    if (visited[idx]) return
    visited[idx] = 1
    queue.push(idx)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }

  let cleared = 0
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]
    const i = idx << 2
    const d = diff(i)
    if (d > tolerance) continue // 角色本体：停止扩散
    if (d <= feather) {
      data[i + 3] = 0
      cleared++
    } else {
      data[i + 3] = Math.round(255 * ((d - feather) / (tolerance - feather)))
    }
    const x = idx % w
    const y = (idx - x) / w
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1)
  }
  return cleared
}

console.log('[2/4] 逐帧抠底')
let bg = null
for (const [n, file] of frameFiles.entries()) {
  const path = join(framesDir, file)
  const png = PNG.sync.read(readFileSync(path))
  if (bg === null) {
    bg = resolveBackground(png, bgFlag)
    console.log(`      背景色: rgb(${bg.join(', ')})`)
  }
  const cleared = removeBackground(png, bg, tolerance)
  writeFileSync(path, PNG.sync.write(png))
  if (n % 10 === 0 || n === frameFiles.length - 1) console.log(`      帧 ${n + 1}/${frameFiles.length}（清除 ${cleared} px）`)
}

const webpPath = resolve('.anim-out.webp')
// 可选：来回播放（正放 + 倒放），得到无缝循环的「转身再转回来」
let sequence = frameFiles.map((f) => join(framesDir, f))
if (pingpong && frameFiles.length > 2) {
  const back = frameFiles.slice(0, -1).reverse().map((f) => join(framesDir, f))
  sequence = [...sequence, ...back]
  console.log(`      来回模式: ${frameFiles.length} 帧 → ${sequence.length} 帧`)
}
// 统一重命名为连续序列，交给 ffmpeg 的 s_%04d 模式
sequence.forEach((src, i) => copyFileSync(src, join(framesDir, `s_${String(i + 1).padStart(4, '0')}.png`)))

console.log(`[3/4] 合成透明动画 WebP（quality ${quality}）`)
execFileSync(ffmpeg.path, [
  '-y', '-framerate', String(fps), '-i', join(framesDir, 's_%04d.png'),
  '-vcodec', 'libwebp', '-lossless', '0', '-q:v', String(quality),
  '-loop', '0', '-an', '-vsync', '0', '-pix_fmt', 'yuva420p',
  webpPath,
], { stdio: ['ignore', 'ignore', 'pipe'] })

/**
 * ffmpeg 的 libwebp 编码器把每帧都写成 BLEND（与前一帧叠加）。带 alpha 的抠图动画
 * 一旦叠加，上一帧永远不会被清除 → 满屏残影。WebP 的 ANMF 帧标志位在 payload 的
 * 第 16 字节（X/Y/W/H/Duration 各 3 字节之后），bit1 = 1 表示「不与前一帧混合」，
 * 每个 chunk 无 CRC，因此直接置位即可无损修正。
 */
function noBlend(webpBuffer) {
  const buf = Buffer.from(webpBuffer)
  let off = 12
  let patched = 0
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (fourcc === 'ANMF' && size >= 16) {
      buf[off + 8 + 15] |= 0x02
      patched++
    }
    off += 8 + size + (size % 2)
  }
  return { buf, patched }
}

const raw = readFileSync(webpPath)
const { buf: webp, patched } = noBlend(raw)
console.log(`      修正 ${patched} 帧为「替换」模式（消除叠加残影）`)

// 静止帧：动画序列的第 1 帧（来回模式下动画结束也会回到它，切换时无缝）
const restPath = resolve('.anim-rest.webp')
execFileSync(ffmpeg.path, [
  '-y', '-i', join(framesDir, 's_0001.png'),
  '-vcodec', 'libwebp', '-lossless', '0', '-q:v', '75',
  restPath,
], { stdio: ['ignore', 'ignore', 'pipe'] })
const rest = readFileSync(restPath)

console.log(`[4/4] 写入资源模块（动画 ${(webp.length / 1024).toFixed(1)} KB + 静止帧 ${(rest.length / 1024).toFixed(1)} KB / ${sequence.length} 帧）`)
const out = resolve('src/client/pet-art.generated.ts')
writeFileSync(out, [
  '// Generated pet art. Regenerate with:',
  '//   node tools/anim-from-video.mjs <video> --start 7 --duration 3 --pingpong [--fps 8] [--width 240]',
  '// 注意：字面量包在 [..].join(\'\') 里是为了阻止打包器把巨型 data URL 内联到每个使用点。',
  '/** 静止姿态（动画首帧，动画播完正好回到它） */',
  `export const PET_REST = ['data:image/webp;base64,${rest.toString('base64')}'].join('')`,
  '/** 交互触发的动画（来回播放，无缝循环） */',
  `export const PET_ANIM = ['data:image/webp;base64,${webp.toString('base64')}'].join('')`,
  `export const PET_FRAMES = ${sequence.length}`,
  `export const PET_FPS = ${fps}`,
  '',
].join('\n'))

if (!keepFrames) rmSync(framesDir, { recursive: true, force: true })
rmSync(webpPath, { force: true })
rmSync(restPath, { force: true })
console.log(`完成: ${out}`)
console.log('下一步: pnpm build → 同步 GitHub → 重启 DSH')
