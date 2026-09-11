import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeRuntimeError } from "../dist/errors.js";

test("normalizes quota and revoked upstream failures to stable Runtime codes", () => {
	const quota = normalizeRuntimeError({ code: "profile_quota_exceeded", status: 409, message: "Profile quota exceeded" });
	assert.equal(quota.code, "runtime_quota_exceeded");
	assert.equal(quota.exitCode, 8);
	assert.equal(quota.retryable, false);
	assert.equal(quota.details.status, 409);
	assert.equal(quota.details.upstreamCode, "profile_quota_exceeded");

	const revoked = normalizeRuntimeError({ code: "runtime_release_revoked", status: 409, message: "Runtime release revoked" });
	assert.equal(revoked.code, "runtime_release_revoked");
	assert.equal(revoked.exitCode, 7);
});

test("runtime start reports a stable not-installed error", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-stable-errors-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
	const result = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath, "runtime", "start", "--json"], {
			env: { ...process.env, ZLOGIN_RUNTIME_HOME: home },
			windowsHide: true
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", chunk => stdout.push(chunk));
		child.stderr.on("data", chunk => stderr.push(chunk));
		child.on("error", reject);
		child.on("exit", code => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
	});
	assert.equal(result.code, 5);
	assert.deepEqual(JSON.parse(result.stdout), { error: "runtime_not_installed", message: "Runtime is not installed", retryable: false });
	assert.equal(result.stderr, "");
});

test("profile quota failure returns the stable Runtime quota code", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-quota-error-"));
	const version = "0.1.0-quota";
	const token = "quota-runtime-token-123456";
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/health") return response.end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: version }));
		if (request.url === "/api/v1/browser-profiles/list") return response.end(JSON.stringify({ success: true, code: "ok", message: "OK", requestId: "quota-list", data: { items: [{ profileId: 9, profileCode: "quota-profile" }] } }));
		if (request.url === "/profile/start") return response.writeHead(409, { "x-request-id": "quota-request" }).end(JSON.stringify({ code: "profile_quota_exceeded", message: "Runtime device quota exceeded" }));
		response.writeHead(404).end(JSON.stringify({ code: "not_found", message: "Not found" }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	await mkdir(join(home, version), { recursive: true });
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	await writeFile(join(home, "endpoint.json"), JSON.stringify({ pid: process.pid, version, port, token, healthUrl: `http://127.0.0.1:${port}/health`, startedAt: new Date().toISOString() }));
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await rm(home, { recursive: true, force: true });
	});

	const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
	const result = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath, "profile", "start", "quota-profile", "--json"], {
			env: {
				...process.env,
				ZLOGIN_RUNTIME_HOME: home,
				ZLOGIN_OPENAPI_URL: `http://127.0.0.1:${port}`,
				ZLOGIN_OPENAPI_KEY: "quota-test-key"
			},
			windowsHide: true
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", chunk => stdout.push(chunk));
		child.stderr.on("data", chunk => stderr.push(chunk));
		child.on("error", reject);
		child.on("exit", code => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
	});
	assert.equal(result.code, 8);
	assert.deepEqual(JSON.parse(result.stdout), {
		error: "runtime_quota_exceeded",
		message: "Runtime device quota exceeded",
		retryable: false,
		status: 409,
		requestId: "quota-request",
		upstreamCode: "profile_quota_exceeded"
	});
	assert.equal(result.stderr, "");
});
