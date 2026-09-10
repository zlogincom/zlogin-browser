import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { downloadAndInstallRuntime, fetchReleaseManifest, readCurrentRuntime, validateReleaseManifest } from "../dist/runtime.js";

const execFileAsync = promisify(execFile);

const makeArchive = async () => {
	const source = await mkdtemp(join(tmpdir(), "zlogin-cli-source-"));
	const archive = join(await mkdtemp(join(tmpdir(), "zlogin-cli-archive-")), "runtime.tar");
	await writeFile(join(source, "runtime-entry.txt"), "runtime-test");
	await execFileAsync("tar", ["-cf", archive, "-C", source, "."]);
	return { source, archive, data: await readFile(archive) };
};

test("validateReleaseManifest rejects non-HTTPS artifact URLs", () => {
	assert.throws(() => validateReleaseManifest({ releaseId: "00000000-0000-4000-8000-000000000001", status: "active", platform: process.platform, arch: process.arch, downloadUrl: "file:///tmp/runtime.tar", sha256: "a".repeat(64), fileSize: 1, signature: "sig", signatureKeyId: "key", runtimeVersion: "0.1.0", protocolVersion: 1, channel: "stable", minApiVersion: "2026-09", minCliVersion: "0.1.0", publishedAt: new Date().toISOString() }), /URL is not trusted/);
});

test("validateReleaseManifest rejects incompatible protocol and minimum CLI versions", () => {
	const base = { releaseId: "00000000-0000-4000-8000-000000000001", status: "active", platform: process.platform, arch: process.arch, downloadUrl: "https://cdn.example.com/runtime.tar", sha256: "a".repeat(64), fileSize: 1, signature: "sig", signatureKeyId: "key", runtimeVersion: "0.1.0", protocolVersion: 1, channel: "stable", minApiVersion: "2026-09", minCliVersion: "0.1.0", publishedAt: new Date().toISOString() };
	assert.throws(() => validateReleaseManifest({ ...base, protocolVersion: 2 }), /protocol version is unsupported/);
	assert.throws(() => validateReleaseManifest({ ...base, minCliVersion: "0.2.0" }), /requires a newer CLI version/);
	assert.throws(() => validateReleaseManifest({ ...base, minCliVersion: "invalid" }), /invalid minimum CLI version/);
});

test("validateReleaseManifest validates the packaged entry point and artifact type", () => {
	const base = { releaseId: "00000000-0000-4000-8000-000000000001", status: "active", platform: process.platform, arch: process.arch, downloadUrl: "https://cdn.example.com/runtime.tar", sha256: "a".repeat(64), fileSize: 1, signature: "sig", signatureKeyId: "key", runtimeVersion: "0.1.0", protocolVersion: 1, channel: "stable", minApiVersion: "2026-09", minCliVersion: "0.1.0", publishedAt: new Date().toISOString() };
	assert.doesNotThrow(() => validateReleaseManifest({ ...base, entryPoint: "dist/index.js", artifactType: "tar.gz" }));
	assert.throws(() => validateReleaseManifest({ ...base, entryPoint: "../outside.js" }), /unsafe entry point/);
	assert.throws(() => validateReleaseManifest({ ...base, entryPoint: "dist/./index.js" }), /unsafe entry point/);
	assert.throws(() => validateReleaseManifest({ ...base, entryPoint: "dist/index.js", artifactType: "exe" }), /unsupported artifact type/);
});

test("fetches the release manifest with the negotiated protocol query", async t => {
	let requestUrl;
	const server = createServer((request, response) => {
		requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		response.setHeader("content-type", "application/json");
		response.writeHead(200).end(JSON.stringify({
			releaseId: "00000000-0000-4000-8000-000000000001",
			runtimeVersion: "0.1.0",
			protocolVersion: 1,
			platform: process.platform,
			arch: process.arch,
			channel: "stable",
			minApiVersion: "2026-09",
			minCliVersion: "0.1.0",
			downloadUrl: "https://cdn.example.com/runtime.tar",
			fileSize: 1,
			sha256: "a".repeat(64),
			signature: "sig",
			signatureKeyId: "key",
			publishedAt: new Date().toISOString(),
			status: "active"
		}));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	t.after(() => server.close());
	await fetchReleaseManifest(`http://127.0.0.1:${port}/api/runtime/releases/latest`, "beta");
	assert.ok(requestUrl);
	assert.equal(requestUrl.searchParams.get("channel"), "beta");
	assert.equal(requestUrl.searchParams.get("platform"), process.platform);
	assert.equal(requestUrl.searchParams.get("arch"), process.arch);
	assert.equal(requestUrl.searchParams.get("protocol_version"), "1");
});

test("downloads, verifies and atomically installs a signed Runtime archive", async t => {
	const fixture = await makeArchive();
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const manifest = {
		releaseId: "00000000-0000-4000-8000-000000000002",
		runtimeVersion: "0.1.0-test",
		protocolVersion: 1,
		platform: process.platform,
		arch: process.arch,
		channel: "stable",
		minApiVersion: "2026-09",
		minCliVersion: "0.1.0",
		downloadUrl: "",
		fileSize: fixture.data.byteLength,
		sha256: createHash("sha256").update(fixture.data).digest("hex"),
		signature: sign(null, fixture.data, privateKey).toString("base64"),
		signatureKeyId: "test-key",
		publishedAt: new Date().toISOString(),
		status: "active"
	};
	const server = createServer((request, response) => {
		if (request.url?.startsWith("/artifact")) {
			response.writeHead(200, { "content-type": "application/octet-stream" });
			response.end(fixture.data);
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	manifest.downloadUrl = `http://127.0.0.1:${port}/artifact`;
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-runtime-"));
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	const previousKeyId = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
	process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID = "test-key";
	t.after(async () => {
		server.close();
		await rm(fixture.source, { recursive: true, force: true });
		await rm(join(fixture.archive, ".."), { recursive: true, force: true });
		await rm(home, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME;
		else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousKey === undefined) delete process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
		else process.env.ZLOGIN_RUNTIME_PUBLIC_KEY = previousKey;
		if (previousKeyId === undefined) delete process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID;
		else process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID = previousKeyId;
	});
	const installed = await downloadAndInstallRuntime(manifest);
	assert.equal(installed.version, manifest.runtimeVersion);
	assert.equal((await readCurrentRuntime()).version, manifest.runtimeVersion);
	assert.equal(await readFile(join(installed.path, "runtime-entry.txt"), "utf8"), "runtime-test");
	assert.deepEqual(JSON.parse(await readFile(join(installed.path, "manifest.json"), "utf8")), manifest);
	const badSignature = { ...manifest, signature: sign(null, Buffer.from("different"), privateKey).toString("base64") };
	await assert.rejects(downloadAndInstallRuntime(badSignature), /signature verification failed/);
	assert.equal((await readCurrentRuntime()).version, manifest.runtimeVersion);
	await writeFile(join(home, "install.lock"), "foreign-process\n");
	await assert.rejects(downloadAndInstallRuntime(manifest));
	assert.equal(await readFile(join(home, "install.lock"), "utf8"), "foreign-process\n");
});
