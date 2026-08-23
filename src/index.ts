/**
 * Node half of the dsh-pet deepwhale plugin. Serves the DeepSeek account
 * balance over a webServer route; the browser half renders the pet.
 */
import type { Context } from '@deepseek-ai/cordis'

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

/** Fetch the DeepSeek balance with the credential seam (never exposes the key). */
async function fetchBalance(ctx: Context): Promise<Record<string, unknown>> {
  const credentials = ctx.get<{ resolve(ref: string): Promise<{ value: string } | undefined> }>('credentials')
  if (!credentials) return { ok: false, error: 'credentials-unavailable' }
  let hit: { value: string } | undefined
  try {
    hit = await credentials.resolve('DEEPSEEK_API_KEY')
  } catch (error) {
    return { ok: false, error: 'credential-error', detail: String((error as Error)?.message ?? error) }
  }
  if (!hit || !hit.value) return { ok: false, error: 'no-api-key', hint: 'DEEPSEEK_API_KEY' }
  try {
    const resp = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${hit.value}` },
      signal: AbortSignal.timeout(15000),
    })
    const data = (await resp.json()) as BalanceResponse
    const info = data.balance_infos?.[0] ?? {}
    return {
      ok: resp.ok,
      status: resp.status,
      isAvailable: data.is_available !== false,
      currency: info.currency ?? '',
      total: info.total_balance,
      granted: info.granted_balance,
      toppedUp: info.topped_up_balance,
    }
  } catch (error) {
    return { ok: false, error: 'fetch-failed', detail: String((error as Error)?.message ?? error) }
  }
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
