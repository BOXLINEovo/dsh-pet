/**
 * Node half of the dsh-pet deepwhale plugin. Serves the DeepSeek account
 * balance over a webServer route; the browser half renders the pet.
 *
 * The balance lookup is deliberately redundant: a direct fetch is retried,
 * then a curl subprocess is tried (a second network stack that survives
 * transient startup DNS/TLS hiccups), and the concrete failure reason is
 * reported so the pet can show it instead of a bare error.
 */
import type { Context } from '@deepseek-ai/cordis'

const PUBLIC_BASE = 'https://api.deepseek.com'
const TIMEOUT_MS = 12000

interface BalanceInfo {
  currency?: string
  total_balance?: string
  granted_balance?: string
  topped_up_balance?: string
}

interface BalanceResponse {
  is_available?: boolean
  balance_infos?: BalanceInfo[]
}

function reason(error: unknown): string {
  const err = error as { message?: string; cause?: { code?: string; message?: string } } | undefined
  const cause = err?.cause
  const code = cause?.code ?? cause?.message
  return `${err?.message ?? String(error)}${code ? ` (${code})` : ''}`
}

function shape(data: BalanceResponse, status: number): Record<string, unknown> {
  const info = data.balance_infos?.[0] ?? {}
  return {
    ok: true,
    status,
    isAvailable: data.is_available !== false,
    currency: info.currency ?? '',
    total: info.total_balance,
    granted: info.granted_balance,
    toppedUp: info.topped_up_balance,
  }
}

/** Endpoint candidates: the deployment's own override first, then the public API. */
function baseCandidates(): string[] {
  const out: string[] = []
  const configured = process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, '')
  if (configured) {
    out.push(configured)
    // a versioned gateway prefix may sit above the public path
    out.push(configured.replace(/\/v\d+$/, ''))
  }
  out.push(PUBLIC_BASE)
  return [...new Set(out)]
}

/** Direct fetch (Node 24 global fetch). */
async function viaFetch(base: string, key: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`${base}/user/balance`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 100)}`)
  return shape(JSON.parse(text) as BalanceResponse, resp.status)
}

/** curl subprocess fallback — an independent stack for transient failures. */
async function viaCurl(ctx: Context, base: string, key: string): Promise<Record<string, unknown>> {
  const subprocess = ctx.get<{
    resolveExecutable(command: string): Promise<string>
    spawn(spec: unknown): {
      done: Promise<{ exitCode: number | null }>
      collected?: { stdout?: { readFrom(offset: number): { text: string } }; stderr?: { readFrom(offset: number): { text: string } } }
    }
  }>('subprocess')
  if (!subprocess) throw new Error('subprocess service unavailable')
  let exe = 'curl.exe'
  try {
    exe = await subprocess.resolveExecutable('curl.exe')
  } catch { /* keep the bare name */ }
  const handle = subprocess.spawn({
    argv: [exe, '-sS', '-m', '12', '-H', `Authorization: Bearer ${key}`, `${base}/user/balance`],
    cwd: process.env.USERPROFILE ?? process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 4096 } },
    graceMs: 4000,
  })
  const outcome = await handle.done
  const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0) {
    const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
    throw new Error(`curl exit ${outcome.exitCode} ${(stderr || stdout).slice(0, 100)}`)
  }
  return shape(JSON.parse(stdout) as BalanceResponse, 200)
}

/** Fetch the DeepSeek balance with the credential seam (never exposes the key). */
async function fetchBalance(ctx: Context): Promise<Record<string, unknown>> {
  const credentials = ctx.get<{ resolve(ref: string): Promise<{ value: string } | undefined> }>('credentials')
  if (!credentials) return { ok: false, error: 'credentials-unavailable' }
  let hit: { value: string } | undefined
  try {
    hit = await credentials.resolve('DEEPSEEK_API_KEY')
  } catch (error) {
    return { ok: false, error: 'credential-error', detail: reason(error) }
  }
  if (!hit || !hit.value) return { ok: false, error: 'no-api-key', hint: 'DEEPSEEK_API_KEY' }

  const key = hit.value
  const bases = baseCandidates()
  const errors: string[] = []
  const ladder: Array<[string, () => Promise<Record<string, unknown>>]> = []
  for (const base of bases) ladder.push([`fetch ${base}`, () => viaFetch(base, key)])
  ladder.push([`fetch ${PUBLIC_BASE} (retry)`, () => viaFetch(PUBLIC_BASE, key)])
  ladder.push([`curl ${PUBLIC_BASE}`, () => viaCurl(ctx, PUBLIC_BASE, key)])

  for (const [label, attempt] of ladder) {
    try {
      return await attempt()
    } catch (error) {
      errors.push(`${label}: ${reason(error)}`)
    }
  }
  return { ok: false, error: 'fetch-failed', detail: errors.slice(-3).join(' | ').slice(0, 300) }
}

interface ServerResponse {
  writeHead(status: number, headers: Record<string, string>): void
  end(body: string): void
}

/** Wait for the web carrier before registering the route. */
export const inject = ['webServer']

/** Web plugin row: registers the balance route, removed with the fiber. */
export function apply(ctx: Context): void {
  const webServer = ctx.get<{ register(route: { kind: string; path: string; handler: (req: unknown, res: ServerResponse) => void | Promise<void> }): () => void }>('webServer')
  if (!webServer) return
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-pet/balance',
    handler: async (_req, res) => {
      const data = await fetchBalance(ctx)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    },
  }))
}
