import { ZLoginApiError, ZLoginTransportError } from "./errors.js";
import type {
	HttpMethod,
	QueryValue,
	ZLoginLaunchOverrides,
	ZLoginProfileListInput,
	ZLoginProfileSelector,
	ZLoginRequestOptions,
	ZLoginResult
} from "./types.js";

interface ZLoginClientOptions {
	apiKey: string;
	baseUrl: string;
	timeoutMs: number;
	fetch?: typeof fetch;
}

interface ResponseEnvelope<TData> {
	success: boolean;
	code: string;
	message: string;
	requestId?: string;
	data: TData;
	errors?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readHeaderNumber = (headers: Headers, name: string): number | null => {
	const value = headers.get(name);
	if (value === null || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const buildPath = (template: string, values: Readonly<Record<string, string | number>> = {}): string => {
	const consumed = new Set<string>();
	const path = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
		const value = values[name];
		if (value === undefined || String(value).trim() === "") throw new TypeError(`Missing path parameter: ${name}`);
		consumed.add(name);
		return encodeURIComponent(String(value));
	});
	const unknown = Object.keys(values).filter((name) => !consumed.has(name));
	if (unknown.length > 0) throw new TypeError(`Unknown path parameter: ${unknown.join(", ")}`);
	return path;
};

const appendQuery = (url: URL, query: Readonly<Record<string, QueryValue>> = {}): void => {
	for (const [name, value] of Object.entries(query)) {
		if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
	}
};

export class ZLoginClient {
	readonly baseUrl: string;
	readonly timeoutMs: number;
	readonly #apiKey: string;
	readonly #fetch: typeof fetch;

	constructor(options: ZLoginClientOptions) {
		this.#apiKey = options.apiKey;
		this.baseUrl = options.baseUrl;
		this.timeoutMs = options.timeoutMs;
		this.#fetch = options.fetch ?? globalThis.fetch;
		if (typeof this.#fetch !== "function") throw new TypeError("A Fetch API implementation is required");
	}

	async request<TData>(
		method: HttpMethod,
		path: string,
		options: ZLoginRequestOptions = {}
	): Promise<ZLoginResult<TData>> {
		const url = new URL(`${this.baseUrl}${buildPath(path, options.path)}`);
		appendQuery(url, options.query);

		const headers = new Headers({ Accept: "application/json" });
		if (options.auth !== false) headers.set("X-Api-Key", this.#apiKey);
		if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
		if (options.ifMatch) headers.set("If-Match", options.ifMatch);
		let body: string | undefined;
		if (options.body !== undefined) {
			headers.set("Content-Type", "application/json");
			body = JSON.stringify(options.body);
		}

		const controller = new AbortController();
		const timeoutMs = options.timeoutMs ?? this.timeoutMs;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);

		let response: Response;
		try {
			response = await this.#fetch(url, {
				method,
				headers,
				...(body === undefined ? {} : { body }),
				signal: controller.signal,
				redirect: "error"
			});
		} catch (error) {
			if (timedOut)
				throw new ZLoginTransportError(
					"REQUEST_TIMEOUT",
					`ZLogin request timed out after ${timeoutMs} ms`,
					error
				);
			throw new ZLoginTransportError("REQUEST_FAILED", "Unable to reach the ZLogin Local Open API", error);
		} finally {
			clearTimeout(timeout);
		}

		let payload: unknown;
		try {
			payload = JSON.parse(await response.text()) as unknown;
		} catch (error) {
			throw new ZLoginTransportError(
				"INVALID_RESPONSE",
				`ZLogin returned non-JSON content with HTTP ${response.status}`,
				error
			);
		}

		if (
			!isRecord(payload) ||
			typeof payload.success !== "boolean" ||
			typeof payload.code !== "string" ||
			typeof payload.message !== "string"
		) {
			throw new ZLoginTransportError("INVALID_RESPONSE", "ZLogin returned an invalid response envelope");
		}

		const envelope = payload as unknown as ResponseEnvelope<TData>;
		const requestId =
			typeof envelope.requestId === "string" ? envelope.requestId : response.headers.get("X-Request-Id");
		if (!response.ok || !envelope.success) {
			throw new ZLoginApiError(
				response.status,
				envelope.code,
				envelope.message,
				requestId,
				envelope.errors ?? null,
				readHeaderNumber(response.headers, "Retry-After")
			);
		}
		if (!requestId) throw new ZLoginTransportError("INVALID_RESPONSE", "ZLogin response is missing requestId");

		return {
			data: envelope.data,
			status: response.status,
			requestId,
			etag: response.headers.get("ETag"),
			rateLimit: {
				limit: readHeaderNumber(response.headers, "X-RateLimit-Limit"),
				remaining: readHeaderNumber(response.headers, "X-RateLimit-Remaining"),
				reset: readHeaderNumber(response.headers, "X-RateLimit-Reset"),
				retryAfter: readHeaderNumber(response.headers, "Retry-After")
			}
		};
	}

	status(): Promise<ZLoginResult<unknown>> {
		return this.request("GET", "/status", { auth: false });
	}

	context(): Promise<ZLoginResult<unknown>> {
		return this.request("GET", "/api/v1/context");
	}

	capabilities(): Promise<ZLoginResult<unknown>> {
		return this.request("GET", "/api/v1/capabilities");
	}

	listProfiles(input: ZLoginProfileListInput): Promise<ZLoginResult<unknown>> {
		return this.request("POST", "/api/v1/browser-profiles/list", { body: input });
	}

	getProfile(selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> {
		return this.request("POST", "/api/v1/browser-profiles/detail", { body: selector });
	}

	getProfileStatus(selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> {
		return this.request("GET", "/api/v1/browser-profiles/active", {
			query: {
				profileId: selector.profileId,
				profileNo: selector.profileNo,
				profileCode: selector.profileCode
			}
		});
	}

	listActiveProfiles(): Promise<ZLoginResult<unknown>> {
		return this.request("GET", "/api/v1/browser-profiles/local-active");
	}

	startProfile(
		selector: ZLoginProfileSelector,
		launchOverrides?: ZLoginLaunchOverrides
	): Promise<ZLoginResult<unknown>> {
		return this.request("POST", "/api/v1/browser-profiles/start", {
			body: { ...selector, ...(launchOverrides ? { launchOverrides } : {}) },
			timeoutMs: Math.max(this.timeoutMs, 60_000)
		});
	}

	stopProfile(selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> {
		return this.request("POST", "/api/v1/browser-profiles/stop", { body: selector });
	}

	showProfile(selector: ZLoginProfileSelector): Promise<ZLoginResult<unknown>> {
		return this.request("POST", "/api/v1/browser-profiles/show", { body: selector });
	}
}
