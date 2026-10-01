/**
 * 在视频里寻找「首帧≈尾帧，且最接近静止图」的片段。
 * 输出：静止图与各帧的内容包围盒对比、每帧与静止图的差异曲线、最佳片段候选。
 *
 *   node tools/find-loop.mjs <视频> <静止图> [--fps 10] [--width 160]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const video = args[0]
const idleImage = args[1]
if (!video || !idleImage) {
  console.error('usage: node tools/find-loop.mjs <video> <idle-image> [--fps 10] [--width 160]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const fps = Number(flag('fps', '10'))
const width = Number(flag('width', '160'))

const dir = resolve('.loop-probe')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

execFileSync(ffmpeg.path, [
  '-y', '-i', resolve(video),
  '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
  '-pix_fmt', 'rgba',
  join(dir, 'v_%04d.png'),
], { stdio: ['ignore', 'ignore', 'pipe'] })

const frameFiles = readdirSync(dir).filter((f) => f.startsWith('v_')).sort()

/** 静止图：统一到与视频帧相同的宽高 */
const tmpIdle = resolve('.loop-probe-idle.png')
execFileSync(ffmpeg.path, ['-y', '-i', resolve(idleImage), '-vf', `scale=${width}:-1:flags=lanczos`, tmpIdle], { stdio: ['ignore', 'ignore', 'pipe'] })

const H = PNG.sync.read(readFileSync(join(dir, frameFiles[0]))).height
execFileSync(ffmpeg.path, ['-y', '-i', resolve(idleImage), '-vf', `scale=${width}:${H}:flags=lanczos`, tmpIdle], { stdio: ['ignore', 'ignore', 'pipe'] })

/** 提取「内容掩膜 + 亮度」，并给出包围盒（视频帧黑底，静止图透明底） */
function profile(png, useAlpha) {
  const { width: w, height: h, data } = png
  const mask = new Uint8Array(w * h)
  const lum = new Float32Array(w * h)
  let minX = w, maxX = -1, minY = h, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) << 2
      const alpha = data[i + 3]
      const l = Math.max(data[i], data[i + 1], data[i + 2])
      const inside = useAlpha ? alpha > 100 : l > 45
      if (!inside) continue
      mask[y * w + x] = 1
      lum[y * w + x] = l
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { w, h, mask, lum, box: { minX, maxX, minY, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }, area: mask.reduce((a, b) => a + b, 0) }
}

const idle = profile(PNG.sync.read(readFileSync(tmpIdle)), true)
console.log(`静止图: 内容 ${idle.box.bw}x${idle.box.bh}  面积 ${idle.area}  宽高比 ${(idle.box.bw / idle.box.bh).toFixed(3)}`)
console.log(`帧尺寸: ${idle.w}x${idle.h}`)

/** 按质心对齐后比较：1 - IoU 掩膜差 + 亮度差 */
function compare(a, b) {
  const dx = Math.round(a.box.cx - b.box.cx)
  const dy = Math.round(a.box.cy - b.box.cy)
  let inter = 0, union = 0, lumDiff = 0, lumN = 0
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const ai = y * a.w + x
      const bx = x + dx, by = y + dy
      const bi = by >= 0 && by < b.h && bx >= 0 && bx < b.w ? by * b.w + bx : -1
      const am = a.mask[ai]
      const bm = bi >= 0 ? b.mask[bi] : 0
      if (am || bm) {
        union++
        if (am && bm) {
          inter++
          lumDiff += Math.abs(a.lum[ai] - b.lum[bi])
          lumN++
        }
      }
    }
  }
  const iou = union ? inter / union : 0
  const lum = lumN ? lumDiff / lumN : 255
  return { score: (1 - iou) * 100 + (lum / 255) * 40, iou, lum }
}

const frames = frameFiles.map((f) => profile(PNG.sync.read(readFileSync(join(dir, f))), false))
console.log('\n每帧 vs 静止图（分数越低越像）:')
const vsIdle = frames.map((fr) => compare(fr, idle))
const rows = []
for (let i = 0; i < frames.length; i++) {
  if (i % 2 === 0 || i === frames.length - 1) {
    rows.push(`${(i / fps).toFixed(1)}s:${vsIdle[i].score.toFixed(1)}(IoU ${vsIdle[i].iou.toFixed(2)},盒 ${frames[i].box.bw}x${frames[i].box.bh})`)
  }
}
console.log(rows.join('  '))

/** 找片段 [i,j]：首尾互相接近，且都尽量接近静止图 */
let best = null
for (let i = 0; i < frames.length - 2; i++) {
  for (let j = i + Math.round(fps * 0.5); j < frames.length; j++) {
    const ends = compare(frames[i], frames[j])
    const score = ends.score * 1.6 + vsIdle[i].score + vsIdle[j].score
    if (!best || score < best.score) best = { i, j, score, ends: ends.score, si: vsIdle[i].score, sj: vsIdle[j].score }
  }
}
console.log(`\n最佳无缝片段: ${(best.i / fps).toFixed(2)}s → ${(best.j / fps).toFixed(2)}s`)
console.log(`  首尾互相差异 ${best.ends.toFixed(1)} | 首帧 vs 静止图 ${best.si.toFixed(1)} | 尾帧 vs 静止图 ${best.sj.toFixed(1)}`)
console.log('\n最接近静止图的帧（前 6）:')
;[...vsIdle.entries()].sort((a, b) => a[1].score - b[1].score).slice(0, 6)
  .forEach(([i, v]) => console.log(`  ${(i / fps).toFixed(2)}s  分数 ${v.score.toFixed(1)}  IoU ${v.iou.toFixed(2)}  盒 ${frames[i].box.bw}x${frames[i].box.bh}`))

rmSync(dir, { recursive: true, force: true })
rmSync(tmpIdle, { force: true })
