import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { getAuthStatus, login, logout } from "../dist/auth.js";

const execFileAsync = promisify(execFile);

test("uses the authenticated Runtime control protocol for device login", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-auth-"));
	const version = "0.1.0-test";
	const token = "test-runtime-token-123456789";
	let polls = 0;
	let logoutCalled = false;
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.headers["x-zlogin-runtime-token"] !== token) {
			response.writeHead(401).end(JSON.stringify({ message: "Unauthorized" }));
			return;
		}
		if (request.url === "/health") response.writeHead(200).end(JSON.stringify({ ok: true }));
		else if (request.url === "/auth/status") response.writeHead(200).end(JSON.stringify({ authenticated: false }));
		else if (request.url === "/auth/login/start") response.writeHead(200).end(JSON.stringify({ loginId: "login-1", userCode: "ABCD-EFGH", verificationUrl: "https://example.com/device", expiresAt: new Date(Date.now() + 5000).toISOString(), pollIntervalMs: 100 }));
		else if (request.url === "/auth/login/poll") {
			polls += 1;
			response.writeHead(200).end(JSON.stringify(polls === 1 ? { status: "pending" } : { status: "authorized", session: { authenticated: true, identity: { userId: "user-1", displayName: "CLI User" }, expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
		} else if (request.url === "/auth/logout") {
			logoutCalled = true;
			response.writeHead(200).end(JSON.stringify({ revoked: true }));
		} else response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await mkdir(join(home, version), { recursive: true });
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	await writeFile(join(home, "endpoint.json"), JSON.stringify({ pid: process.pid, version, port, token, healthUrl: `http://127.0.0.1:${port}/health`, startedAt: new Date().toISOString() }));
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await rm(home, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME;
		else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
	});
	assert.deepEqual(await getAuthStatus(), { authenticated: false });
	const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
	const childResult = await execFileAsync(process.execPath, [cliPath, "auth", "status", "--json"], {
		env: { ...process.env, ZLOGIN_RUNTIME_HOME: home }
	});
	assert.deepEqual(JSON.parse(childResult.stdout), { authenticated: false });
	let challenge;
	const session = await login({ noBrowser: true, timeoutMs: 3000, onStarted: value => { challenge = value; } });
	assert.equal(challenge.userCode, "ABCD-EFGH");
	assert.equal(session.identity.displayName, "CLI User");
	assert.equal((await logout()).revoked, true);
	assert.equal(logoutCalled, true);
});
