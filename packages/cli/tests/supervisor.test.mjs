import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requireRuntimeEndpoint } from "../dist/control.js";
import { getRuntimeStatus, startRuntime, stopRuntime } from "../dist/supervisor.js";

const fixtureSource = `
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const endpointIndex = process.argv.indexOf("--endpoint-file");
const endpointFile = process.argv[endpointIndex + 1];
const token = randomBytes(24).toString("hex");
const server = createServer((request, response) => {
  if (request.headers["x-zlogin-runtime-token"] !== token) { response.writeHead(401); response.end(); return; }
  if (request.url === "/health") { response.writeHead(200); response.end(JSON.stringify({ ok: true })); return; }
  if (request.url === "/shutdown" && request.method === "POST") { response.writeHead(202); response.end(); setTimeout(() => server.close(() => process.exit(0)), 10); return; }
  response.writeHead(404); response.end();
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  await writeFile(endpointFile, JSON.stringify({ pid: process.pid, version: process.env.ZLOGIN_RUNTIME_VERSION, port: address.port, token, healthUrl: "http://127.0.0.1:" + address.port + "/health", startedAt: new Date().toISOString() }));
});
`;

test("starts, reuses, health-checks and stops one Runtime instance", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-supervisor-"));
	const fixture = join(home, "fixture.mjs");
	const version = "0.1.0-test";
	await writeFile(fixture, fixtureSource);
	await writeFile(join(home, "current.json"), JSON.stringify({ version }));
	await mkdir(join(home, version), { recursive: true });
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

	const restarted = await requireRuntimeEndpoint({ executable: process.execPath, launchArgs: [fixture], timeoutMs: 5000, intervalMs: 25 });
	assert.equal(restarted.version, version);
	assert.equal((await getRuntimeStatus()).running, true);
});
