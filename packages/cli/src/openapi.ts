import type { ZLoginProfileSelector, ZLoginResult } from "zlogin-core";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ResponseEnvelope<T> {
	success: boolean;
	code: string;
	message: string;
	requestId?: string;
	data: T;
	errors?: unknown;
}

export class OpenApiRequestError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number,
		readonly requestId: string | null
	) {
		super(message);
	}
}

const readNumber = (headers: Headers, name: string): number | null => {
	const value = headers.get(name);
	if (value === null || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const resolveBaseUrl = (): URL => {
	const url = new URL(process.env.ZLOGIN_OPENAPI_URL ?? "http://127.0.0.1:50025");
	if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
		throw new Error("ZLogin Local Open API URL must use loopback HTTP");
	}
	url.pathname = url.pathname.replace(/\/$/, "");
	url.search = "";
	url.hash = "";
	return url;
};

const requireApiKey = (): string => {
	const apiKey = process.env.ZLOGIN_OPENAPI_KEY?.trim();
	if (!apiKey) throw new Error("ZLOGIN_OPENAPI_KEY is not configured");
	return apiKey;
};

export const openApiRequest = async <T>(method: HttpMethod, pathname: string, body?: unknown, timeoutMs = 30000, query?: Record<string, string>): Promise<ZLoginResult<T>> => {
	if (!pathname.startsWith("/api/v1/") || pathname.includes("..") || pathname.includes("?")) throw new Error("Open API path must be an /api/v1 route without a query string");
	const url = resolveBaseUrl();
	url.pathname = `${url.pathname === "/" ? "" : url.pathname}${pathname}`;
	for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response;
	try {
		response = await fetch(url, {
			method,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-Api-Key": requireApiKey()
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
			redirect: "error"
		});
	} catch (error) {
		if (controller.signal.aborted) throw new OpenApiRequestError(`Open API request timed out after ${timeoutMs}ms`, "REQUEST_TIMEOUT", 0, null);
		throw new OpenApiRequestError(error instanceof Error ? error.message : "Unable to reach the ZLogin Local Open API", "REQUEST_FAILED", 0, null);
	} finally {
		clearTimeout(timer);
	}
	let envelope: ResponseEnvelope<T>;
	try {
		envelope = JSON.parse(await response.text()) as ResponseEnvelope<T>;
	} catch {
		throw new OpenApiRequestError("Open API returned invalid JSON", "INVALID_RESPONSE", response.status, response.headers.get("X-Request-Id"));
	}
	if (!envelope || typeof envelope.success !== "boolean" || typeof envelope.code !== "string" || typeof envelope.message !== "string") {
		throw new OpenApiRequestError("Open API returned an invalid response envelope", "INVALID_RESPONSE", response.status, response.headers.get("X-Request-Id"));
	}
	const requestId = envelope.requestId ?? response.headers.get("X-Request-Id");
	if (!response.ok || !envelope.success) throw new OpenApiRequestError(envelope.message, envelope.code, response.status, requestId);
	if (!requestId) throw new OpenApiRequestError("Open API response is missing requestId", "INVALID_RESPONSE", response.status, null);
	return {
		data: envelope.data,
		status: response.status,
		requestId,
		etag: response.headers.get("ETag"),
		rateLimit: {
			limit: readNumber(response.headers, "X-RateLimit-Limit"),
			remaining: readNumber(response.headers, "X-RateLimit-Remaining"),
			reset: readNumber(response.headers, "X-RateLimit-Reset"),
			retryAfter: readNumber(response.headers, "Retry-After")
		}
	};
};

export const listProfiles = (): Promise<ZLoginResult<unknown>> => openApiRequest("POST", "/api/v1/browser-profiles/list", { page: 1, pageSize: 100 });
export const startProfile = (selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> => openApiRequest("POST", "/api/v1/browser-profiles/start", selector, 60000);
export const stopProfile = (selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> => openApiRequest("POST", "/api/v1/browser-profiles/stop", selector);

export const getProfileStatus = (selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> => {
	return openApiRequest("GET", "/api/v1/browser-profiles/active", undefined, 30000, { profileCode: String(selector.profileCode) });
};
