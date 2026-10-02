/**
 * Browser half of the dsh-pet deepwhale plugin: a draggable, flip-able
 * desktop pet that reports the DeepSeek account balance in cute rice-themed
 * sayings. Pure-DOM implementation — no React — mirrored on the maid-atelier
 * client pattern, with every write retracted by the Cordis effect disposer.
 */
import { PET_ANIMS, PET_IDLE } from './pet-art.ts'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
const CHAR_W = 170
const CHAR_H = 234
const BUBBLE_H = 96
const PAD = 10
const CALENDAR_TTL_MS = 6 * 60 * 60 * 1000

/** 投喂按钮文案（轮换，避免死板） */
const FEED_LABELS = [
  '投喂白饭',
  '鱼饿了，加饭',
  '续个饭盆',
  '求投喂',
  '加饭时间到',
]
const FLIP_MS = 300

/** 可爱发言池：每句都带上余额（a 形如 ¥110.00） */
const SAYINGS = [
  (a: string) => `白饭就剩${a}了！`,
  (a: string) => `今天的口粮还有${a}，够吃~`,
  (a: string) => `${a}的白饭，够我游很久呢！`,
  (a: string) => `宝，白饭只剩${a}了，要省着点吃…`,
  (a: string) => `数了数米缸，还有${a}的白饭！`,
  (a: string) => `咕噜…白饭就剩${a}了，好想吃！`,
  (a: string) => `肚子咕咕叫，口粮还有${a}~`,
  (a: string) => `${a}的白饭，感觉可以囤起来！`,
  (a: string) => `盯…那是${a}的白饭吗？想吃！`,
]

const css = `
.dshp-wrap {
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.dshp-wrap:active { cursor: grabbing; }
.dshp-breathe {
  transform-origin: 50% 100%;
}
.dshp-char { position: relative; }
.dshp-flip {
  transform-origin: 50% 50%;
  transition: transform 0.3s ease;
  z-index: 0;
}
.dshp-img {
  width: 170px;
  height: auto;
  display: block;
  filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.3));
}
.dshp-bubble {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 10;
  min-width: 150px;
  max-width: 320px;
  padding: 10px 16px 11px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  text-align: center;
}
.dshp-bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -8px;
  transform: translateX(-50%);
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-top: 10px solid var(--dsw-alias-bg-overlay);
}
.dshp-main { font-size: 16px; font-weight: 700; line-height: 1.45; color: var(--dsw-alias-label-primary); letter-spacing: 0.2px; }
.dshp-period {
  font-size: 11px;
  line-height: 1.35;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
}
.dshp-period.dshp-off { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.dshp-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; line-height: 1.3; }
.dshp-link {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 14px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.5;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease;
}
.dshp-link:hover { background: var(--dsw-alias-bg-layer-1); }
`

function fmt(v: unknown): string {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? n.toFixed(2) : String(v == null ? '' : v)
}
function symbol(c: unknown): string {
  return c === 'CNY' ? '¥' : (c ? `${c} ` : '')
}

/**
 * DeepSeek 价格时段（https://api-docs.deepseek.com/zh-cn/quick_start/pricing/）：
 *   高峰 — 北京时间周一至周五（不含中国法定节假日）9:00-12:00、14:00-18:00
 *   空闲 — 其余所有时段（含周末与中国法定节假日全天），价格为高峰的一半
 * 按 UTC+8 计算，不受用户本地时区影响。
 */
const PEAK_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/** Expand one 放假区间 into day keys. */
function expandRange(startISO: string, days: number): string[] {
  const [y, m, d] = startISO.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < days; i++) out.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10))
  return out
}

/**
 * 兜底用的法定节假日（2026，国务院办公厅通知）。
 * 运行时优先使用 `/dsh-pet/calendar` 实时抓取的日历；此表仅在抓取失败时生效，
 * 保证离线/断网时时段判定仍然可用。
 */
const FALLBACK_HOLIDAYS = new Set<string>([
  ...expandRange('2026-01-01', 3), // 元旦
  ...expandRange('2026-02-15', 9), // 春节
  ...expandRange('2026-04-04', 3), // 清明
  ...expandRange('2026-05-01', 5), // 劳动节
  ...expandRange('2026-06-19', 3), // 端午
  ...expandRange('2026-09-25', 3), // 中秋
  ...expandRange('2026-10-01', 7), // 国庆
])

/** Beijing wall-clock parts for one instant. */
function bjParts(ms: number): { key: string; dow: number; minutes: number } {
  const shifted = new Date(ms + 8 * 3600 * 1000)
  return {
    key: shifted.toISOString().slice(0, 10),
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

function isPeakAt(ms: number, holidays: ReadonlySet<string>): boolean {
  const p = bjParts(ms)
  if (p.dow === 0 || p.dow === 6) return false // 周末全天空闲
  if (holidays.has(p.key)) return false // 法定节假日全天空闲
  return PEAK_BLOCKS.some(([from, to]) => p.minutes >= from && p.minutes < to)
}

function periodNow(holidays: ReadonlySet<string>): { peak: boolean; text: string } {
  const now = Date.now()
  const peak = isPeakAt(now, holidays)
  // walk forward minute by minute (≤14 days) to the next state change
  let cursor = now
  const limit = now + 14 * 24 * 60 * 60 * 1000
  while (cursor < limit && isPeakAt(cursor, holidays) === peak) cursor += 60 * 1000
  const totalMin = Math.max(0, Math.round((cursor - now) / 60000))
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const minutes = totalMin % 60
  const left = `${days > 0 ? `${days}天` : ''}${hours > 0 ? `${hours}小时` : ''}${minutes}分`
  return peak
    ? { peak: true, text: `高峰时段 · 白饭原价，距空闲 ${left}` }
    : { peak: false, text: `空闲时段 · 白饭半价，还剩 ${left}` }
}

export function apply(ctx: { effect(callback: () => () => void): unknown }): void {
  const view = { node: null as HTMLElement | null, rect: null as DOMRect | null }
  const state = { x: 0, y: 0, facing: 'left' as 'left' | 'right' }
  const drag = { current: null as null | {
    id: number; sx: number; sy: number; ox: number; oy: number
    moved: boolean; movedDist: number; px: number; py: number; acc: number; rect: DOMRect
  } }
  let lastPos: { x: number; y: number } | null = null

  // ---- styles + root ----
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-pet-deepwhale'
  style.textContent = css
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;'
  document.body.appendChild(root)

  // ---- pet DOM ----
  const wrap = document.createElement('div')
  wrap.className = 'dshp-wrap'
  wrap.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:auto;'
  root.appendChild(wrap)

  const breathe = document.createElement('div')
  breathe.className = 'dshp-breathe'
  wrap.appendChild(breathe)

  const char = document.createElement('div')
  char.className = 'dshp-char'
  breathe.appendChild(char)

  const bubble = document.createElement('div')
  bubble.className = 'dshp-bubble'
  char.appendChild(bubble)

  const main = document.createElement('div')
  main.className = 'dshp-main'
  main.textContent = '深度思考中…'
  bubble.appendChild(main)

  const period = document.createElement('div')
  period.className = 'dshp-period'
  bubble.appendChild(period)

  const sub = document.createElement('div')
  sub.className = 'dshp-sub'
  sub.style.display = 'none'
  bubble.appendChild(sub)

  const link = document.createElement('a')
  link.className = 'dshp-link'
  link.href = TOP_UP_URL
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.title = '前往 DeepSeek 充值页'
  link.textContent = FEED_LABELS[0]
  bubble.appendChild(link)

  const flip = document.createElement('div')
  flip.className = 'dshp-flip'
  flip.style.transform = 'perspective(700px) rotateY(0deg)'
  char.appendChild(flip)

  const img = document.createElement('img')
  img.className = 'dshp-img'
  img.src = PET_IDLE
  img.alt = 'DeepSeek 大肥鱼'
  img.draggable = false
  flip.appendChild(img)

  // ---- helpers ----
  const setFacing = (dir: 'left' | 'right'): void => {
    if (state.facing === dir) return
    state.facing = dir
    flip.style.transform = dir === 'left' ? 'perspective(700px) rotateY(0deg)' : 'perspective(700px) rotateY(180deg)'
  }
  const setPos = (x: number, y: number): void => {
    state.x = x
    state.y = y
    wrap.style.left = `${x}px`
    wrap.style.top = `${y}px`
  }
  const faceCenter = (): void => {
    const r = view.rect ?? (view.node ? view.node.getBoundingClientRect() : null)
    const dir = state.x < (r ? r.width / 2 : state.x) ? 'right' : 'left'
    setFacing(dir)
  }

  // ---- 交互动画：只在点击时随机播放一个，且只播一次（拖拽不触发） ----
  let animTimer: number | undefined

  const playRandomAnim = (): void => {
    if (PET_ANIMS.length === 0) return
    const anim = PET_ANIMS[Math.floor(Math.random() * PET_ANIMS.length)]
    if (animTimer !== undefined) {
      window.clearTimeout(animTimer)
      animTimer = undefined
    }
    const start = (): void => {
      img.src = anim.src
      animTimer = window.setTimeout(() => {
        img.src = PET_IDLE
        animTimer = undefined
      }, anim.duration)
    }
    // 同一动画连续触发时，先切回静止图再切回来，强制从头播放
    if (img.src === anim.src) {
      img.src = PET_IDLE
      window.requestAnimationFrame(start)
    } else {
      start()
    }
  }

  // ---- peak / off-peak hint (live holiday calendar) ----
  const holidays = new Set<string>(FALLBACK_HOLIDAYS)
  let calendarAt = 0
  let calendarBusy = false

  const syncPeriod = (): void => {
    const p = periodNow(holidays)
    period.textContent = p.text
    period.classList.toggle('dshp-off', !p.peak)
  }

  const refreshCalendar = async (): Promise<void> => {
    if (calendarBusy || Date.now() - calendarAt < CALENDAR_TTL_MS) return
    calendarBusy = true
    const first = Number(bjParts(Date.now()).key.slice(0, 4))
    let fetched = 0
    try {
      for (const y of [first, first + 1]) {
        try {
          const resp = await fetch(`/dsh-pet/calendar?year=${y}`, { cache: 'no-store' })
          const data = (await resp.json()) as { ok?: boolean; days?: Array<{ date?: string; off?: boolean }> }
          if (!data.ok || !Array.isArray(data.days)) continue
          for (const day of data.days) if (day.off && day.date) holidays.add(day.date)
          fetched++
        } catch { /* keep the fallback for this year */ }
      }
      if (fetched > 0) calendarAt = Date.now()
    } finally {
      calendarBusy = false
    }
    syncPeriod()
  }

  // ---- balance ----
  const fetchOnce = async (): Promise<
    { ok: true; line: string } | { ok: false; code: string; detail?: string }
  > => {
    const resp = await fetch('/dsh-pet/balance', { cache: 'no-store' })
    const r = (await resp.json()) as {
      ok?: boolean
      error?: string
      detail?: string
      currency?: string
      total?: string
    }
    if (r.ok) {
      const amt = symbol(r.currency) + fmt(r.total)
      link.textContent = FEED_LABELS[Math.floor(Math.random() * FEED_LABELS.length)]
      void refreshCalendar()
      return { ok: true, line: SAYINGS[Math.floor(Math.random() * SAYINGS.length)](amt) }
    }
    return { ok: false, code: r.error ?? '未知错误', detail: r.detail }
  }

  const refreshBalance = async (attempt = 0): Promise<void> => {
    main.textContent = '深度思考中…'
    sub.style.display = 'none'
    let failure: { code: string; detail?: string } | null = null
    try {
      const result = await fetchOnce()
      if (result.ok) {
        main.textContent = result.line
        return
      }
      failure = { code: result.code, detail: result.detail }
    } catch (error) {
      failure = { code: 'rpc', detail: String((error as Error)?.message ?? error) }
    }
    // transient startup/network hiccups: retry twice before surfacing the error
    if (attempt < 2) {
      window.setTimeout(() => { void refreshBalance(attempt + 1) }, 3000)
      return
    }
    main.textContent = '余额获取失败'
    const code = failure.code === 'no-api-key' ? '未配置 API Key' : failure.code
    sub.textContent = failure.detail ? `${code} · ${failure.detail.slice(0, 70)}` : code
    sub.style.display = ''
  }

  // ---- interactions ----
  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    try { wrap.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const r = view.node ? view.node.getBoundingClientRect() : view.rect
    if (!r) return
    drag.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY,
      ox: state.x, oy: state.y, moved: false, movedDist: 0,
      px: e.clientX, py: e.clientY, acc: 0, rect: r,
    }
  }
  const onPointerMove = (e: PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    d.px = e.clientX
    d.py = e.clientY
    d.movedDist += Math.abs(dx) + Math.abs(dy)
    if (d.movedDist > 6) d.moved = true
    const nx = Math.max(CHAR_W / 2 + PAD, Math.min(d.rect.width - CHAR_W / 2 - PAD, d.ox + (e.clientX - d.sx)))
    const ny = Math.max(CHAR_H + BUBBLE_H, Math.min(d.rect.height - 8, d.oy + (e.clientY - d.sy)))
    d.acc += dx
    if (Math.abs(d.acc) > 20) {
      setFacing(d.acc > 0 ? 'right' : 'left')
      d.acc = 0
    }
    setPos(nx, ny)
  }
  const onPointerUp = (e: PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    try { wrap.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d.moved) {
      lastPos = { x: state.x, y: state.y }
      faceCenter()
    } else {
      pet()
    }
  }
  const onLinkDown = (e: Event): void => e.stopPropagation()

  /** 点击：播放随机动画 + 刷新余额（已移除挤压动画与爱心效果） */
  const pet = (): void => {
    playRandomAnim()
    void refreshBalance()
  }

  wrap.addEventListener('pointerdown', onPointerDown)
  wrap.addEventListener('pointermove', onPointerMove)
  wrap.addEventListener('pointerup', onPointerUp)
  wrap.addEventListener('pointercancel', onPointerUp)
  link.addEventListener('pointerdown', onLinkDown)
  link.addEventListener('click', onLinkDown)

  // ---- initial placement ----
  const rect = root.getBoundingClientRect()
  view.node = root
  view.rect = rect
  const x0 = lastPos ? lastPos.x : Math.max(CHAR_W / 2 + PAD, rect.width - CHAR_W / 2 - PAD)
  const y0 = lastPos ? lastPos.y : Math.max(CHAR_H + BUBBLE_H, rect.height - 40)
  state.facing = x0 < rect.width / 2 ? 'right' : 'left'
  flip.style.transform = state.facing === 'left' ? 'perspective(700px) rotateY(0deg)' : 'perspective(700px) rotateY(180deg)'
  setPos(x0, y0)

  void refreshBalance()
  void refreshCalendar()
  syncPeriod()
  const timer = window.setInterval(() => { void refreshBalance() }, 5 * 60 * 1000)
  const periodTimer = window.setInterval(syncPeriod, 30 * 1000)
  const calendarTimer = window.setInterval(() => { void refreshCalendar() }, 30 * 60 * 1000)

  ctx.effect(() => () => {
    window.clearInterval(timer)
    window.clearInterval(periodTimer)
    window.clearInterval(calendarTimer)
    wrap.removeEventListener('pointerdown', onPointerDown)
    wrap.removeEventListener('pointermove', onPointerMove)
    wrap.removeEventListener('pointerup', onPointerUp)
    wrap.removeEventListener('pointercancel', onPointerUp)
    link.removeEventListener('pointerdown', onLinkDown)
    link.removeEventListener('click', onLinkDown)
    root.remove()
    style.remove()
  })
}
