import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getProfileStatusWithRuntime, startProfileWithRuntime, stopProfileWithRuntime } from "../dist/runtimeProfile.js";

test("resolves an Open API profile code and delegates profile lifecycle to Runtime", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-runtime-profile-"));
	const version = "0.1.0-test";
	const token = "runtime-profile-token-123456";
	const requests = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push({ method: request.method, url: request.url, runtimeToken: request.headers["x-zlogin-runtime-token"], apiKey: request.headers["x-api-key"], body: body ? JSON.parse(body) : null });
		response.setHeader("content-type", "application/json");
		if (request.url === "/health") return response.end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: version }));
		if (request.url === "/api/v1/browser-profiles/list") return response.end(JSON.stringify({ success: true, code: "ok", message: "OK", requestId: "list-1", data: { items: [{ profileId: 73, profileCode: "demo-profile" }] } }));
		if (request.url === "/profile/start") return response.end(JSON.stringify({ profileId: 73, runtimeId: "runtime-73", pid: 1234, protocol: "cdp", debuggerAddress: "127.0.0.1:9222", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/runtime-73", expiresAt: "2026-09-09T12:00:00Z" }));
		if (request.url === "/profile/73/status") return response.end(JSON.stringify({ profileId: 73, state: "running", runtimeId: "runtime-73" }));
		if (request.url === "/profile/73/stop") return response.end(JSON.stringify({ profileId: 73, state: "stopped" }));
		response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	await mkdir(join(home, version), { recursive: true });
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	await writeFile(join(home, "endpoint.json"), JSON.stringify({ pid: process.pid, version, port, token, healthUrl: `http://127.0.0.1:${port}/health`, startedAt: new Date().toISOString() }));
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousUrl = process.env.ZLOGIN_OPENAPI_URL;
	const previousKey = process.env.ZLOGIN_OPENAPI_KEY;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	process.env.ZLOGIN_OPENAPI_URL = `http://127.0.0.1:${port}`;
	process.env.ZLOGIN_OPENAPI_KEY = "test-openapi-key";
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await rm(home, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME; else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousUrl === undefined) delete process.env.ZLOGIN_OPENAPI_URL; else process.env.ZLOGIN_OPENAPI_URL = previousUrl;
		if (previousKey === undefined) delete process.env.ZLOGIN_OPENAPI_KEY; else process.env.ZLOGIN_OPENAPI_KEY = previousKey;
	});
	assert.equal((await startProfileWithRuntime({ profileCode: "demo-profile" })).profileId, 73);
	assert.equal((await getProfileStatusWithRuntime({ profileCode: "demo-profile" })).state, "running");
	assert.equal((await stopProfileWithRuntime({ profileCode: "demo-profile" })).state, "stopped");
	assert.ok(requests.filter(request => request.url?.startsWith("/profile/") || request.url === "/profile/start").every(request => request.runtimeToken === token));
	assert.deepEqual(requests.find(request => request.url === "/api/v1/browser-profiles/list").body, { page: 1, pageSize: 100 });
});
