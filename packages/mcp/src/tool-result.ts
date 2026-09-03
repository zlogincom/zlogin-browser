import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZLoginApiError, ZLoginTransportError } from "./errors.js";
import type { ZLoginResult } from "./types.js";

export const successResult = (data: unknown, meta?: Record<string, unknown>): CallToolResult => {
	const payload: Record<string, unknown> = { ok: true, data, ...(meta ? { meta } : {}) };
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload
	};
};

export const apiSuccessResult = (result: ZLoginResult<unknown>): CallToolResult =>
	successResult(result.data, {
		requestId: result.requestId,
		etag: result.etag,
		rateLimit: result.rateLimit
	});

export const errorResult = (error: unknown): CallToolResult => {
	let detail: Record<string, unknown>;
	if (error instanceof ZLoginApiError) {
		detail = {
			type: "zlogin_api_error",
			status: error.status,
			code: error.code,
			message: error.message,
			requestId: error.requestId,
			retryAfter: error.retryAfter
		};
	} else if (error instanceof ZLoginTransportError) {
		detail = { type: "zlogin_transport_error", code: error.code, message: error.message };
	} else if (error instanceof TypeError) {
		detail = { type: "invalid_tool_arguments", code: "INVALID_TOOL_ARGUMENTS", message: error.message };
	} else if (error instanceof Error) {
		detail = { type: "tool_error", code: "TOOL_ERROR", message: error.message };
	} else {
		detail = { type: "internal_error", code: "INTERNAL_ERROR", message: "Unexpected zlogin-mcp error" };
	}

	const payload = { ok: false, error: detail };
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload,
		isError: true
	};
};

export const validationErrorResult = (messages: string[]): CallToolResult =>
	errorResult(
		new TypeError(messages.length > 0 ? messages.join("; ") : "Tool arguments did not match the input schema")
	);
