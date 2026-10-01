//#region src/index.ts
const PUBLIC_BASE = "https://api.deepseek.com";
const TIMEOUT_MS = 12e3;
const CALENDAR_TTL_MS = 216e5;
function reason(error) {
	const err = error;
	const cause = err?.cause;
	const code = cause?.code ?? cause?.message;
	return `${err?.message ?? String(error)}${code ? ` (${code})` : ""}`;
}
function shape(data, status) {
	const info = data.balance_infos?.[0] ?? {};
	return {
		ok: true,
		status,
		isAvailable: data.is_available !== false,
		currency: info.currency ?? "",
		total: info.total_balance,
		granted: info.granted_balance,
		toppedUp: info.topped_up_balance
	};
}
/** Endpoint candidates: the deployment's own override first, then the public API. */
function baseCandidates() {
	const out = [];
	const configured = process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, "");
	if (configured) {
		out.push(configured);
		out.push(configured.replace(/\/v\d+$/, ""));
	}
	out.push(PUBLIC_BASE);
	return [...new Set(out)];
}
/** Direct fetch (Node global fetch). */
async function viaFetch(base, key) {
	const resp = await fetch(`${base}/user/balance`, {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	const text = await resp.text();
	if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 100)}`);
	return shape(JSON.parse(text), resp.status);
}
/** curl subprocess fallback — an independent stack for transient failures. */
async function viaCurl(ctx, base, key) {
	const subprocess = ctx.get("subprocess");
	if (!subprocess) throw new Error("subprocess service unavailable");
	let exe = "curl.exe";
	try {
		exe = await subprocess.resolveExecutable("curl.exe");
	} catch {}
	const handle = subprocess.spawn({
		argv: [
			exe,
			"-sS",
			"-m",
			"12",
			"-H",
			`Authorization: Bearer ${key}`,
			`${base}/user/balance`
		],
		cwd: process.env.USERPROFILE ?? process.cwd(),
		stdio: {
			stdin: "ignore",
			stdout: { maxBytes: 8192 },
			stderr: { maxBytes: 4096 }
		},
		graceMs: 4e3
	});
	const outcome = await handle.done;
	const stdout = handle.collected?.stdout?.readFrom(0).text ?? "";
	if (outcome.exitCode !== 0) {
		const stderr = handle.collected?.stderr?.readFrom(0).text ?? "";
		throw new Error(`curl exit ${outcome.exitCode} ${(stderr || stdout).slice(0, 100)}`);
	}
	return shape(JSON.parse(stdout), 200);
}
/** Fetch the DeepSeek balance with the credential seam (never exposes the key). */
async function fetchBalance(ctx) {
	const credentials = ctx.get("credentials");
	if (!credentials) return {
		ok: false,
		error: "credentials-unavailable"
	};
	let hit;
	try {
		hit = await credentials.resolve("DEEPSEEK_API_KEY");
	} catch (error) {
		return {
			ok: false,
			error: "credential-error",
			detail: reason(error)
		};
	}
	if (!hit || !hit.value) return {
		ok: false,
		error: "no-api-key",
		hint: "DEEPSEEK_API_KEY"
	};
	const key = hit.value;
	const errors = [];
	const ladder = [];
	for (const base of baseCandidates()) ladder.push([`fetch ${base}`, () => viaFetch(base, key)]);
	ladder.push([`fetch ${PUBLIC_BASE} (retry)`, () => viaFetch(PUBLIC_BASE, key)]);
	ladder.push([`curl ${PUBLIC_BASE}`, () => viaCurl(ctx, PUBLIC_BASE, key)]);
	for (const [label, attempt] of ladder) try {
		return await attempt();
	} catch (error) {
		errors.push(`${label}: ${reason(error)}`);
	}
	return {
		ok: false,
		error: "fetch-failed",
		detail: errors.slice(-3).join(" | ").slice(0, 300)
	};
}
const calendarCache = /* @__PURE__ */ new Map();
/** Order matters: the most authoritative source first. */
function calendarSources(year) {
	return [
		{
			name: "holiday-cn",
			load: async () => {
				const resp = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`, {
					headers: { "User-Agent": "dsh-pet" },
					signal: AbortSignal.timeout(TIMEOUT_MS)
				});
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				return ((await resp.json()).days ?? []).filter((d) => d.date).map((d) => ({
					date: String(d.date),
					off: d.isOffDay === true
				}));
			}
		},
		{
			name: "jiejiariapi",
			load: async () => {
				const resp = await fetch(`https://api.jiejiariapi.com/v1/holidays/${year}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				const data = await resp.json();
				return Object.values(data).filter((d) => d?.date).map((d) => ({
					date: String(d.date),
					off: d.isOffDay === true
				}));
			}
		},
		{
			name: "timor",
			load: async () => {
				const resp = await fetch(`https://timor.tech/api/holiday/year/${year}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				const data = await resp.json();
				return Object.values(data.holiday ?? {}).filter((d) => d?.date).map((d) => ({
					date: String(d.date),
					off: d.holiday === true
				}));
			}
		}
	];
}
/** Live holiday calendar for one year, cached; null when every source failed. */
async function loadCalendar(year) {
	const cached = calendarCache.get(year);
	if (cached && Date.now() - cached.at < CALENDAR_TTL_MS) return {
		days: cached.days,
		source: "cache"
	};
	const errors = [];
	for (const source of calendarSources(year)) try {
		const days = await source.load();
		if (days.length > 0) {
			calendarCache.set(year, {
				at: Date.now(),
				days
			});
			return {
				days,
				source: source.name
			};
		}
		errors.push(`${source.name}: empty`);
	} catch (error) {
		errors.push(`${source.name}: ${reason(error)}`);
	}
	console.error("[dsh-pet] calendar fetch failed:", errors.join(" | "));
	return null;
}
function sendJson(res, data) {
	res.writeHead(200, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(data));
}
/** Wait for the web carrier before registering the routes. */
const inject = ["webServer"];
/** Web plugin row: registers the balance and calendar routes, removed with the fiber. */
function apply(ctx) {
	const webServer = ctx.get("webServer");
	if (!webServer) return;
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/dsh-pet/balance",
		handler: async (_req, res) => sendJson(res, await fetchBalance(ctx))
	}));
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/dsh-pet/calendar",
		handler: async (req, res) => {
			const requested = Number(new URL(req?.url ?? "/", "http://localhost").searchParams.get("year"));
			const year = Number.isFinite(requested) && requested > 1970 ? requested : (/* @__PURE__ */ new Date()).getUTCFullYear();
			const result = await loadCalendar(year);
			if (!result) return sendJson(res, {
				ok: false,
				year,
				error: "calendar-unavailable"
			});
			sendJson(res, {
				ok: true,
				year,
				source: result.source,
				days: result.days
			});
		}
	}));
}
//#endregion
export { apply, inject };
