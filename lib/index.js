//#region src/index.ts
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
			detail: String(error?.message ?? error)
		};
	}
	if (!hit || !hit.value) return {
		ok: false,
		error: "no-api-key",
		hint: "DEEPSEEK_API_KEY"
	};
	try {
		const resp = await fetch("https://api.deepseek.com/user/balance", {
			headers: { Authorization: `Bearer ${hit.value}` },
			signal: AbortSignal.timeout(15e3)
		});
		const data = await resp.json();
		const info = data.balance_infos?.[0] ?? {};
		return {
			ok: resp.ok,
			status: resp.status,
			isAvailable: data.is_available !== false,
			currency: info.currency ?? "",
			total: info.total_balance,
			granted: info.granted_balance,
			toppedUp: info.topped_up_balance
		};
	} catch (error) {
		return {
			ok: false,
			error: "fetch-failed",
			detail: String(error?.message ?? error)
		};
	}
}
/** Wait for the web carrier before registering the route. */
const inject = ["webServer"];
/** Web plugin row: registers the balance route, removed with the fiber. */
function apply(ctx) {
	const webServer = ctx.get("webServer");
	if (!webServer) return;
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/dsh-pet/balance",
		handler: async (_req, res) => {
			const data = await fetchBalance(ctx);
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify(data));
		}
	}));
}
//#endregion
export { apply, inject };
