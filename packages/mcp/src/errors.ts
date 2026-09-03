export class ZLoginApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly requestId: string | null,
		readonly errors: unknown = null,
		readonly retryAfter: number | null = null
	) {
		super(message);
		this.name = "ZLoginApiError";
	}
}

export class ZLoginTransportError extends Error {
	constructor(
		readonly code: "REQUEST_TIMEOUT" | "REQUEST_FAILED" | "INVALID_RESPONSE",
		message: string,
		override readonly cause?: unknown
	) {
		super(message);
		this.name = "ZLoginTransportError";
	}
}
