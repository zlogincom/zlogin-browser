import { getRuntimeStatus, restartRuntimeAfterCrash, startRuntime, type RuntimeEndpoint, type StartRuntimeOptions } from "./supervisor.js";

class RuntimeControlResponseError extends Error {}

export const requireRuntimeEndpoint = async (startOptions: StartRuntimeOptions = {}): Promise<RuntimeEndpoint> => {
	const status = await getRuntimeStatus();
	if (status.running && status.endpoint) return status.endpoint;
	return startRuntime(startOptions);
};

const requestRuntimeEndpoint = async <T>(endpoint: RuntimeEndpoint, pathname: string, init: RequestInit, timeoutMs: number): Promise<T> => {
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
			throw new RuntimeControlResponseError(body?.message ?? `Runtime control request failed (${response.status})`);
		}
		return await response.json() as T;
	} finally {
		clearTimeout(timer);
	}
};

export const runtimeControlRequest = async <T>(pathname: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T> => {
	if (!pathname.startsWith("/") || pathname.includes("..") || pathname.includes("?")) throw new Error("Runtime control path is invalid");
	let endpoint = await requireRuntimeEndpoint();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			return await requestRuntimeEndpoint<T>(endpoint, pathname, init, timeoutMs);
		} catch (error) {
			if (attempt > 0 || error instanceof RuntimeControlResponseError || init.body !== undefined && typeof init.body !== "string") throw error;
			let restarted: RuntimeEndpoint | null;
			try {
				restarted = await restartRuntimeAfterCrash(endpoint);
			} catch (restartError) {
				const message = restartError instanceof Error ? restartError.message : "Runtime restart failed";
				throw new Error(`Runtime crashed and automatic restart failed: ${message}`, { cause: error });
			}
			if (!restarted) throw error;
			endpoint = restarted;
		}
	}
	throw new Error("Runtime control request exhausted its single restart attempt");
};
