import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readCurrentRuntime } from "../dist/runtime.js";
import { getRuntimeStatus, startRuntime, stopRuntime } from "../dist/supervisor.js";
import { updateRuntime } from "../dist/updater.js";

const execFileAsync = promisify(execFile);

const runtimeSource = version => `
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const endpointFile = process.argv[process.argv.indexOf("--endpoint-file") + 1];
const token = randomBytes(24).toString("hex");
const server = createServer((request, response) => {
  if (request.headers["x-zlogin-runtime-token"] !== token) { response.writeHead(401).end(); return; }
  if (request.url === "/health") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: ${JSON.stringify(version)} })); return; }
  if (request.url === "/shutdown" && request.method === "POST") { response.writeHead(202).end(); setTimeout(() => server.close(() => process.exit(0)), 10); return; }
  response.writeHead(404).end();
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  await writeFile(endpointFile, JSON.stringify({ pid: process.pid, version: ${JSON.stringify(version)}, port: address.port, token, healthUrl: "http://127.0.0.1:" + address.port + "/health", startedAt: new Date().toISOString() }));
});
`;

const makeRelease = async (version, source) => {
	const sourceRoot = await mkdtemp(join(tmpdir(), "zlogin-cli-update-source-"));
	const archiveRoot = await mkdtemp(join(tmpdir(), "zlogin-cli-update-archive-"));
	const archive = join(archiveRoot, "runtime.tar");
	await mkdir(join(sourceRoot, "dist"), { recursive: true });
	await writeFile(join(sourceRoot, "dist", "index.js"), source);
	await execFileAsync("tar", ["-cf", archive, "-C", sourceRoot, "."]);
	const data = await readFile(archive);
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return { sourceRoot, archiveRoot, archive, data, publicKey, privateKey, version };
};

const serveRelease = async (release, t) => {
	const server = createServer((request, response) => {
		if (request.url === "/ticket") {
			response.writeHead(302, { location: "/artifact" }).end();
			return;
		}
		if (request.url === "/artifact") {
			response.writeHead(200, { "content-length": String(release.data.byteLength) });
			response.end(release.data);
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const address = server.address();
	return `http://127.0.0.1:${address.port}/ticket`;
};

const manifestFor = (release, downloadUrl) => ({
	releaseId: "00000000-0000-4000-8000-000000000030",
	runtimeVersion: release.version,
	protocolVersion: 1,
	platform: process.platform,
	arch: process.arch,
	channel: "stable",
	minApiVersion: "2026-09",
	minCliVersion: "0.1.0",
	entryPoint: "dist/index.js",
	artifactType: "tar",
	downloadUrl,
	fileSize: release.data.byteLength,
	sha256: createHash("sha256").update(release.data).digest("hex"),
	signature: sign(null, release.data, release.privateKey).toString("base64"),
	signatureKeyId: "update-test-key",
	publishedAt: new Date().toISOString(),
	status: "active"
});

test("updates through the API ticket redirect and commits after candidate health", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-update-home-"));
	const release = await makeRelease("0.2.0", runtimeSource("0.2.0"));
	const downloadUrl = await serveRelease(release, t);
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = release.publicKey.export({ type: "spki", format: "pem" }).toString();
	t.after(async () => {
		try { await stopRuntime(1000); } catch { /* process may already be gone */ }
		await rm(home, { recursive: true, force: true });
		await rm(release.sourceRoot, { recursive: true, force: true });
		await rm(release.archiveRoot, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME; else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousKey === undefined) delete process.env.ZLOGIN_RUNTIME_PUBLIC_KEY; else process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = previousKey;
	});

	const result = await updateRuntime(manifestFor(release, downloadUrl), { timeoutMs: 5000, intervalMs: 25 });
	assert.equal(result.installed.version, "0.2.0");
	assert.equal(result.endpoint.version, "0.2.0");
	assert.equal((await getRuntimeStatus()).running, true);
	assert.equal((await readCurrentRuntime()).version, "0.2.0");
});

test("restores and restarts the previous Runtime when candidate health fails", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-update-rollback-"));
	const oldVersion = "0.1.0-old";
	await mkdir(join(home, oldVersion, "dist"), { recursive: true });
	await writeFile(join(home, oldVersion, "dist", "index.js"), runtimeSource(oldVersion));
	await writeFile(join(home, oldVersion, "manifest.json"), JSON.stringify({ entryPoint: "dist/index.js" }));
	await writeFile(join(home, "current.json"), JSON.stringify({ version: oldVersion }));
	const release = await makeRelease("0.2.0-bad", "process.exit(17);\n");
	const downloadUrl = await serveRelease(release, t);
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = release.publicKey.export({ type: "spki", format: "pem" }).toString();
	t.after(async () => {
		try { await stopRuntime(1000); } catch { /* process may already be gone */ }
		await rm(home, { recursive: true, force: true });
		await rm(release.sourceRoot, { recursive: true, force: true });
		await rm(release.archiveRoot, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME; else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousKey === undefined) delete process.env.ZLOGIN_RUNTIME_PUBLIC_KEY; else process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = previousKey;
	});

	const oldEndpoint = await startRuntime({ timeoutMs: 5000, intervalMs: 25 });
	await assert.rejects(updateRuntime(manifestFor(release, downloadUrl), { timeoutMs: 500, intervalMs: 25 }), /health check timed out/);
	assert.equal((await readCurrentRuntime()).version, oldVersion);
	const restored = await getRuntimeStatus();
	assert.equal(restored.running, true);
	assert.equal(restored.endpoint.version, oldVersion);
	assert.notEqual(restored.endpoint.pid, oldEndpoint.pid);
});

test("rejects an untrusted download redirect before changing the installed Runtime", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-update-redirect-"));
	const oldVersion = "0.1.0-current";
	await mkdir(join(home, oldVersion), { recursive: true });
	await writeFile(join(home, "current.json"), JSON.stringify({ version: oldVersion }));
	const release = await makeRelease("0.2.0-untrusted", runtimeSource("0.2.0-untrusted"));
	const server = createServer((_request, response) => {
		response.writeHead(302, { location: "http://example.com/runtime.tar" }).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const downloadUrl = `http://127.0.0.1:${address.port}/ticket`;
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = release.publicKey.export({ type: "spki", format: "pem" }).toString();
	t.after(async () => {
		server.close();
		await rm(home, { recursive: true, force: true });
		await rm(release.sourceRoot, { recursive: true, force: true });
		await rm(release.archiveRoot, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME; else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousKey === undefined) delete process.env.ZLOGIN_RUNTIME_PUBLIC_KEY; else process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = previousKey;
	});

	await assert.rejects(updateRuntime(manifestFor(release, downloadUrl)), /redirect is not trusted/);
	assert.equal((await readCurrentRuntime()).version, oldVersion);
});
