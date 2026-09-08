import { getRuntimeStatus, type RuntimeEndpoint } from "./supervisor.js";

export const requireRuntimeEndpoint = async (): Promise<RuntimeEndpoint> => {
	const status = await getRuntimeStatus();
	if (!status.running || !status.endpoint) throw new Error("Runtime is not running");
	return status.endpoint;
};

export const runtimeControlRequest = async <T>(pathname: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T> => {
	if (!pathname.startsWith("/") || pathname.includes("..") || pathname.includes("?")) throw new Error("Runtime control path is invalid");
	const endpoint = await requireRuntimeEndpoint();
	const url = new URL(endpoint.healthUrl);
	url.pathname = pathname;
	url.search = "";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				"content-type": "application/json",
				"x-zlogin-runtime-token": endpoint.token,
				...init.headers
			},
			signal: controller.signal
		});
		if (!response.ok) {
			const body = await response.json().catch(() => null) as { message?: string } | null;
			throw new Error(body?.message ?? `Runtime control request failed (${response.status})`);
		}
		return await response.json() as T;
	} finally {
		clearTimeout(timer);
	}
};
