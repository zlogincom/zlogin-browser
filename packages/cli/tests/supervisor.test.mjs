import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runtimeControlRequest } from "../dist/control.js";
import { getRuntimeStatus, runtimeHealth, startRuntime, stopRuntime } from "../dist/supervisor.js";

const execFileAsync = promisify(execFile);

const fixtureSource = `
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
const endpointIndex = process.argv.indexOf("--endpoint-file");
const endpointFile = process.argv[endpointIndex + 1];
const launchCountFile = join(dirname(endpointFile), "launch-count.txt");
const launchCount = Number(await readFile(launchCountFile, "utf8").catch(() => "0")) + 1;
await writeFile(launchCountFile, String(launchCount));
const token = randomBytes(24).toString("hex");
const server = createServer(async (request, response) => {
  if (request.headers["x-zlogin-runtime-token"] !== token) { response.writeHead(401); response.end(); return; }
  if (request.url === "/health") { response.writeHead(200); response.end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: process.env.ZLOGIN_RUNTIME_VERSION })); return; }
  if (request.url === "/business-error") { response.writeHead(409, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "profile_quota_exceeded", message: "Runtime business conflict" })); return; }
  if (request.url === "/disconnect") { request.socket.destroy(); return; }
  if (request.url === "/crash-once") {
    const marker = join(dirname(endpointFile), "crash-once.marker");
    if (!await readFile(marker, "utf8").then(() => true).catch(() => false)) {
      await writeFile(marker, "crashed"); request.socket.destroy(); setImmediate(() => process.exit(17)); return;
    }
    response.end(JSON.stringify({ ok: true, pid: process.pid })); return;
  }
  if (request.url === "/always-crash") { request.socket.destroy(); setImmediate(() => process.exit(18)); return; }
  if (request.url === "/shutdown" && request.method === "POST") { response.writeHead(202); response.end(); setTimeout(() => server.close(() => process.exit(0)), 10); return; }
  response.writeHead(404); response.end();
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  await writeFile(endpointFile, JSON.stringify({ pid: process.pid, version: process.env.ZLOGIN_RUNTIME_VERSION, port: address.port, token, healthUrl: "http://127.0.0.1:" + address.port + "/health", startedAt: new Date().toISOString() }));
});
`;

test("rejects a Runtime health response with an incompatible protocol", async t => {
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ ok: true, protocolVersion: 2, runtimeVersion: "0.1.0" }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	t.after(() => server.close());
	assert.equal(await runtimeHealth({ pid: process.pid, version: "0.1.0", port, token: "health-token-123456", healthUrl: `http://127.0.0.1:${port}/health`, startedAt: new Date().toISOString() }), false);
});

test("starts, reuses, health-checks and stops one Runtime instance", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-supervisor-"));
	const version = "0.1.0-test";
	await mkdir(join(home, version), { recursive: true });
	const fixture = join(home, version, "fixture.mjs");
	await writeFile(fixture, fixtureSource);
	await writeFile(join(home, version, "manifest.json"), JSON.stringify({ entryPoint: "fixture.mjs" }));
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	t.after(async () => {
		try { await stopRuntime(1000); } catch { /* fixture may already be gone */ }
		for (let attempt = 0; attempt < 10; attempt += 1) {
			try { await rm(home, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
		}
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME;
		else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
	});
	const first = await startRuntime({ executable: process.execPath, launchArgs: [fixture], timeoutMs: 5000, intervalMs: 25 });
	assert.equal(first.version, version);
	assert.equal((await getRuntimeStatus()).running, true);
	const second = await startRuntime({ executable: process.execPath, launchArgs: [fixture], timeoutMs: 1000 });
	assert.equal(second.pid, first.pid);
	assert.equal(await stopRuntime(3000), true);
	const stopped = await getRuntimeStatus();
	assert.equal(stopped.running, false);
	assert.equal(stopped.endpoint, null);

	const launcher = join(home, "launcher.mjs");
	await writeFile(
		launcher,
		`import { requireRuntimeEndpoint } from ${JSON.stringify(new URL("../dist/control.js", import.meta.url).href)};\nawait requireRuntimeEndpoint({ timeoutMs: 5000, intervalMs: 25 });\n`
	);
	await execFileAsync(process.execPath, [launcher], { env: { ...process.env, ZLOGIN_RUNTIME_HOME: home } });
	const restarted = (await getRuntimeStatus()).endpoint;
	assert.ok(restarted);
	assert.equal(restarted.version, version);
	assert.equal((await getRuntimeStatus()).running, true);
});

test("restarts a crashed Runtime once and does not restart for business errors", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-runtime-recovery-"));
	const version = "0.1.0-recovery";
	await mkdir(join(home, version), { recursive: true });
	const fixture = join(home, version, "fixture.mjs");
	await writeFile(fixture, fixtureSource);
	await writeFile(join(home, version, "manifest.json"), JSON.stringify({ entryPoint: "fixture.mjs" }));
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	t.after(async () => {
		try { await stopRuntime(1000); } catch { /* fixture may already be gone */ }
		for (let attempt = 0; attempt < 10; attempt += 1) {
			try { await rm(home, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
		}
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME;
		else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
	});

	const first = await startRuntime({ timeoutMs: 5000, intervalMs: 25 });
	await assert.rejects(runtimeControlRequest("/business-error"), error => {
		assert.equal(error.code, "runtime_quota_exceeded");
		assert.equal(error.details.status, 409);
		assert.equal(error.details.upstreamCode, "profile_quota_exceeded");
		return /Runtime business conflict/.test(error.message);
	});
	assert.equal(Number(await readFile(join(home, "launch-count.txt"), "utf8")), 1);
	await assert.rejects(runtimeControlRequest("/disconnect"));
	assert.equal(Number(await readFile(join(home, "launch-count.txt"), "utf8")), 1);
	assert.equal((await getRuntimeStatus()).running, true);

	const recovered = await runtimeControlRequest("/crash-once");
	assert.equal(recovered.ok, true);
	assert.notEqual(recovered.pid, first.pid);
	assert.equal(Number(await readFile(join(home, "launch-count.txt"), "utf8")), 2);

	await assert.rejects(runtimeControlRequest("/always-crash"));
	assert.equal(Number(await readFile(join(home, "launch-count.txt"), "utf8")), 3);
	assert.equal((await getRuntimeStatus()).running, false);
});
