import { getRuntimeStatus, restartRuntimeAfterCrash, startRuntime, type RuntimeEndpoint, type StartRuntimeOptions } from "./supervisor.js";
import { ZLoginCliError, normalizeRuntimeError } from "./errors.js";

export class RuntimeControlResponseError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number,
		readonly requestId: string | null
	) {
		super(message);
		this.name = "RuntimeControlResponseError";
	}
}

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
			const body = await response.json().catch(() => null) as { message?: string; detail?: string; title?: string; code?: string; error?: string; requestId?: string } | null;
			throw new RuntimeControlResponseError(
				body?.message ?? body?.detail ?? body?.title ?? `Runtime control request failed (${response.status})`,
				body?.code ?? body?.error ?? "runtime_request_failed",
				response.status,
				body?.requestId ?? response.headers.get("x-request-id")
			);
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
			if (error instanceof RuntimeControlResponseError) throw normalizeRuntimeError(error, error.message);
			if (attempt > 0 || init.body !== undefined && typeof init.body !== "string") {
				throw new ZLoginCliError("runtime_unavailable", error instanceof Error ? error.message : "Runtime became unavailable", 6, true, {}, { cause: error });
			}
			let restarted: RuntimeEndpoint | null;
			try {
				restarted = await restartRuntimeAfterCrash(endpoint);
			} catch (restartError) {
				const normalized = normalizeRuntimeError(restartError, "Runtime restart failed");
				throw new ZLoginCliError("runtime_unavailable", `Runtime crashed and automatic restart failed: ${normalized.message}`, 6, true, {}, { cause: error });
			}
			if (!restarted) throw new ZLoginCliError("runtime_unavailable", "Runtime became unavailable and could not be restarted", 6, true, {}, { cause: error });
			endpoint = restarted;
		}
	}
	throw new ZLoginCliError("runtime_unavailable", "Runtime control request exhausted its single restart attempt", 6, true);
};
