/**
 * dsh-pet 素材管线。
 *
 * 静止图（默认显示，运行时应使用最初的立绘）：
 *   node tools/anim-from-video.mjs --idle <图片> [--width 240] [--height 320] [--quality 75]
 *     → 写出 src/client/pet-idle.generated.ts
 *
 * 交互动画（点击时随机播放一个；可多次执行以添加多个动画）：
 *   node tools/anim-from-video.mjs <视频> --name turn [--start 7] [--duration 3] [--pingpong]
 *                                        [--fps 8] [--width 240] [--quality 58] [--tolerance 45]
 *     → 写出 src/client/anim-<name>.generated.ts
 *
 * 每生成一个动画，就在 src/client/pet-art.ts 里 import 并加入 PET_ANIMS 数组。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const idleImage = flag('idle', null)
const video = args[0] && !args[0].startsWith('--') ? args[0] : null

if (!idleImage && !video) {
  console.error('用法:')
  console.error('  静止图  node tools/anim-from-video.mjs --idle <图片> [--width 240] [--height 320] [--quality 75]')
  console.error('  交互动画 node tools/anim-from-video.mjs <视频> --name turn [--start 7] [--duration 3] [--pingpong]')
  console.error('                                        [--fps 8] [--width 240] [--quality 58] [--tolerance 45]')
  process.exit(2)
}

const width = Number(flag('width', '240'))
const quality = Number(flag('quality', idleImage ? '75' : '58'))
const QUALITY = quality
const keepFrames = has('keep-frames')

/** data URL 用 [..].join('') 包裹，阻止打包器把巨型字面量内联到每个使用点。 */
const dataUrlLine = (name, buffer) => `export const ${name} = ['data:image/webp;base64,${buffer.toString('base64')}'].join('')`

// ---------------------------------------------------------------- 静止图模式
if (idleImage) {
  const height = Number(flag('height', '320'))
  const out = resolve('src/client/pet-idle.generated.ts')
  const tmp = resolve('.idle-tmp.webp')
  console.log(`[idle] ${idleImage} → ${width}x${height}, quality ${QUALITY}`)
  execFileSync(ffmpeg.path, [
    '-y', '-i', resolve(idleImage),
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    '-vcodec', 'libwebp', '-lossless', '0', '-q:v', String(QUALITY),
    tmp,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const buf = readFileSync(tmp)
  writeFileSync(out, [
    '// Generated idle art. Regenerate with:',
    '//   node tools/anim-from-video.mjs --idle <图片> --width 240 --height 320',
    '/** 默认静止姿态（点击动画播完也回到它） */',
    dataUrlLine('PET_IDLE', buf),
    '',
  ].join('\n'))
  rmSync(tmp, { force: true })
  console.log(`完成: ${out} (${(buf.length / 1024).toFixed(1)} KB)`)
  process.exit(0)
}

// ---------------------------------------------------------------- 动画模式
const name = flag('name', 'turn')
const fps = Number(flag('fps', '8'))
const bgFlag = flag('bg', 'auto')
const tolerance = Number(flag('tolerance', '45'))
const start = flag('start', null)
const duration = flag('duration', null)
const pingpong = has('pingpong')

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
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
}

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
    if (d > tolerance) continue
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

let sequence = frameFiles.map((f) => join(framesDir, f))
if (pingpong && frameFiles.length > 2) {
  const back = frameFiles.slice(0, -1).reverse().map((f) => join(framesDir, f))
  sequence = [...sequence, ...back]
  console.log(`      来回模式: ${frameFiles.length} 帧 → ${sequence.length} 帧`)
}
sequence.forEach((src, i) => copyFileSync(src, join(framesDir, `s_${String(i + 1).padStart(4, '0')}.png`)))

const webpPath = resolve('.anim-out.webp')
console.log(`[3/4] 合成透明动画 WebP（quality ${QUALITY}）`)
execFileSync(ffmpeg.path, [
  '-y', '-framerate', String(fps), '-i', join(framesDir, 's_%04d.png'),
  '-vcodec', 'libwebp', '-lossless', '0', '-q:v', String(QUALITY),
  '-loop', '0', '-an', '-vsync', '0', '-pix_fmt', 'yuva420p',
  webpPath,
], { stdio: ['ignore', 'ignore', 'pipe'] })

/**
 * ffmpeg 的 libwebp 把每帧都写成 BLEND（与前一帧叠加）。带 alpha 的抠图动画一旦叠加，
 * 上一帧永远不会被清除 → 满屏残影。ANMF 帧标志位在 payload 第 16 字节（X/Y/W/H/Duration
 * 各 3 字节之后），bit1 = 1 表示「不与前一帧混合」；chunk 无 CRC，直接置位即可。
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

const { buf: webp, patched } = noBlend(readFileSync(webpPath))
const slug = name.replace(/[^a-zA-Z0-9_-]/g, '')
const out = resolve(`src/client/anim-${slug}.generated.ts`)
console.log(`[4/4] 修正 ${patched} 帧为「替换」模式 → ${out}（${(webp.length / 1024).toFixed(1)} KB / ${sequence.length} 帧）`)
writeFileSync(out, [
  '// Generated animation. Regenerate with:',
  `//   node tools/anim-from-video.mjs <视频> --name ${slug} --start 7 --duration 3 --pingpong`,
  `/** ${slug} 动画（${sequence.length} 帧 @ ${fps}fps） */`,
  dataUrlLine('ANIM_SRC', webp),
  `export const ANIM_FRAMES = ${sequence.length}`,
  `export const ANIM_FPS = ${fps}`,
  '',
].join('\n'))

if (!keepFrames) rmSync(framesDir, { recursive: true, force: true })
rmSync(webpPath, { force: true })
console.log(`完成: ${out}`)
console.log(`记得在 src/client/pet-art.ts 里 import 并加入 PET_ANIMS（名字: ${slug}）`)
