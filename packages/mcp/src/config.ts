import type { ZLoginMcpConfig } from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:50025";
const DEFAULT_TIMEOUT_MS = 60_000;

const readBoolean = (value: string | undefined, name: string): boolean => {
	if (value === undefined || value.trim() === "") return false;
	if (value === "true" || value === "1") return true;
	if (value === "false" || value === "0") return false;
	throw new Error(`${name} must be true, false, 1, or 0`);
};

const readTimeout = (value: string | undefined): number => {
	if (value === undefined || value.trim() === "") return DEFAULT_TIMEOUT_MS;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 300_000) {
		throw new Error("ZLOGIN_TIMEOUT_MS must be an integer between 1000 and 300000");
	}
	return parsed;
};

const readBaseUrl = (value: string | undefined): string => {
	let url: URL;
	try {
		url = new URL(value?.trim() || DEFAULT_BASE_URL);
	} catch {
		throw new Error("ZLOGIN_BASE_URL must be an absolute HTTP(S) URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("ZLOGIN_BASE_URL must use HTTP or HTTPS");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("ZLOGIN_BASE_URL must not contain credentials, query parameters, or a fragment");
	}
	return url.href.replace(/\/+$/, "");
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ZLoginMcpConfig => {
	const apiKey = env.ZLOGIN_API_KEY?.trim();
	if (!apiKey) throw new Error("ZLOGIN_API_KEY is required");

	return {
		apiKey,
		baseUrl: readBaseUrl(env.ZLOGIN_BASE_URL),
		timeoutMs: readTimeout(env.ZLOGIN_TIMEOUT_MS),
		enableAutomation:
			env.ZLOGIN_ENABLE_AUTOMATION === undefined
				? true
				: readBoolean(env.ZLOGIN_ENABLE_AUTOMATION, "ZLOGIN_ENABLE_AUTOMATION")
	};
};
