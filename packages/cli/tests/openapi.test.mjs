import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { getProfileStatus, listProfiles, OpenApiRequestError, startProfile, stopProfile } from "../dist/openapi.js";

test("profile commands use loopback Open API with API key and stable metadata", async t => {
	const requests = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push({ method: request.method, url: request.url, apiKey: request.headers["x-api-key"], body: body ? JSON.parse(body) : null });
		response.writeHead(200, { "content-type": "application/json", "x-request-id": `request-${requests.length}`, etag: '"v1"', "x-ratelimit-limit": "100" });
		response.end(JSON.stringify({ success: true, code: "ok", message: "OK", data: { call: requests.length } }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const previousUrl = process.env.ZLOGIN_OPENAPI_URL;
	const previousKey = process.env.ZLOGIN_OPENAPI_KEY;
	process.env.ZLOGIN_OPENAPI_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
	process.env.ZLOGIN_OPENAPI_KEY = "test-api-key";
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		if (previousUrl === undefined) delete process.env.ZLOGIN_OPENAPI_URL; else process.env.ZLOGIN_OPENAPI_URL = previousUrl;
		if (previousKey === undefined) delete process.env.ZLOGIN_OPENAPI_KEY; else process.env.ZLOGIN_OPENAPI_KEY = previousKey;
	});
	assert.equal((await listProfiles()).rateLimit.limit, 100);
	await startProfile({ profileCode: "profile-a" });
	await getProfileStatus({ profileCode: "profile-a" });
	await stopProfile({ profileCode: "profile-a" });
	assert.deepEqual(requests.map(request => [request.method, request.url]), [
		["POST", "/api/v1/browser-profiles/list"],
		["POST", "/api/v1/browser-profiles/start"],
		["GET", "/api/v1/browser-profiles/active?profileCode=profile-a"],
		["POST", "/api/v1/browser-profiles/stop"]
	]);
	assert.ok(requests.every(request => request.apiKey === "test-api-key"));
	assert.deepEqual(requests[1].body, { profileCode: "profile-a" });
});

test("Open API transport rejects remote hosts", async () => {
	const previousUrl = process.env.ZLOGIN_OPENAPI_URL;
	const previousKey = process.env.ZLOGIN_OPENAPI_KEY;
	process.env.ZLOGIN_OPENAPI_URL = "https://example.com";
	process.env.ZLOGIN_OPENAPI_KEY = "test-api-key";
	try {
		await assert.rejects(listProfiles(), /loopback HTTP/);
	} finally {
		if (previousUrl === undefined) delete process.env.ZLOGIN_OPENAPI_URL; else process.env.ZLOGIN_OPENAPI_URL = previousUrl;
		if (previousKey === undefined) delete process.env.ZLOGIN_OPENAPI_KEY; else process.env.ZLOGIN_OPENAPI_KEY = previousKey;
	}
	assert.equal(OpenApiRequestError.prototype instanceof Error, true);
});

test("Open API transport preserves business error metadata", async t => {
	const server = createServer((_request, response) => {
		response.writeHead(409, { "content-type": "application/json", "x-request-id": "request-conflict" });
		response.end(JSON.stringify({ success: false, code: "profile_running", message: "Profile is already running", data: null }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const previousUrl = process.env.ZLOGIN_OPENAPI_URL;
	const previousKey = process.env.ZLOGIN_OPENAPI_KEY;
	process.env.ZLOGIN_OPENAPI_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
	process.env.ZLOGIN_OPENAPI_KEY = "test-api-key";
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		if (previousUrl === undefined) delete process.env.ZLOGIN_OPENAPI_URL; else process.env.ZLOGIN_OPENAPI_URL = previousUrl;
		if (previousKey === undefined) delete process.env.ZLOGIN_OPENAPI_KEY; else process.env.ZLOGIN_OPENAPI_KEY = previousKey;
	});
	await assert.rejects(startProfile({ profileCode: "profile-a" }), error => {
		assert.equal(error.code, "profile_running");
		assert.equal(error.status, 409);
		assert.equal(error.requestId, "request-conflict");
		return true;
	});
});
