import assert from "node:assert/strict";
import test from "node:test";
import { ZLoginClient } from "../src/client.js";
import { ZLoginApiError, ZLoginTransportError } from "../src/errors.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
	new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json", "X-Request-Id": "request-1", ...init.headers }
	});

test("listProfiles sends API key and preserves response metadata", async () => {
	let capturedUrl: URL | undefined;
	let capturedInit: RequestInit | undefined;
	const client = new ZLoginClient({
		apiKey: "secret-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 1_000,
		fetch: async (input, init) => {
			capturedUrl = new URL(String(input));
			capturedInit = init;
			return jsonResponse(
				{
					success: true,
					code: "OK",
					message: "ok",
					requestId: "request-1",
					data: { items: [], totalCount: 0 }
				},
				{ headers: { ETag: '"revision-1"', "X-RateLimit-Limit": "5", "X-RateLimit-Remaining": "4" } }
			);
		}
	});

	const result = await client.listProfiles({ pageNumber: 2, pageSize: 10, keyword: "work" });

	assert.equal(capturedUrl?.pathname, "/api/v1/browser-profiles/list");
	assert.equal(capturedInit?.method, "POST");
	assert.equal(new Headers(capturedInit?.headers).get("X-Api-Key"), "secret-key");
	assert.deepEqual(JSON.parse(String(capturedInit?.body)), { pageNumber: 2, pageSize: 10, keyword: "work" });
	assert.equal(result.requestId, "request-1");
	assert.equal(result.etag, '"revision-1"');
	assert.equal(result.rateLimit.limit, 5);
	assert.equal(result.rateLimit.remaining, 4);
});

test("status does not send the API key to an unauthenticated route", async () => {
	let headers = new Headers();
	const client = new ZLoginClient({
		apiKey: "secret-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 1_000,
		fetch: async (_input, init) => {
			headers = new Headers(init?.headers);
			return jsonResponse({
				success: true,
				code: "OK",
				message: "ok",
				requestId: "request-1",
				data: { status: "ok" }
			});
		}
	});

	await client.status();

	assert.equal(headers.has("X-Api-Key"), false);
});

test("API failures expose stable error fields without the API key", async () => {
	const client = new ZLoginClient({
		apiKey: "secret-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 1_000,
		fetch: async () =>
			jsonResponse(
				{
					success: false,
					code: "PROFILE_NOT_FOUND",
					message: "Profile not found",
					requestId: "request-2",
					data: null
				},
				{ status: 404, headers: { "Retry-After": "3" } }
			)
	});

	await assert.rejects(client.getProfile({ profileCode: "missing" }), (error: unknown) => {
		assert.ok(error instanceof ZLoginApiError);
		assert.equal(error.status, 404);
		assert.equal(error.code, "PROFILE_NOT_FOUND");
		assert.equal(error.requestId, "request-2");
		assert.equal(error.retryAfter, 3);
		assert.equal(error.message.includes("secret-key"), false);
		return true;
	});
});

test("transport timeouts are reported with a stable local code", async () => {
	const client = new ZLoginClient({
		apiKey: "secret-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 5,
		fetch: async (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			})
	});

	await assert.rejects(
		client.context(),
		(error: unknown) => error instanceof ZLoginTransportError && error.code === "REQUEST_TIMEOUT"
	);
});
