import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { downloadAndInstallRuntime, readCurrentRuntime, validateReleaseManifest } from "../dist/runtime.js";

const execFileAsync = promisify(execFile);

const makeArchive = async () => {
	const source = await mkdtemp(join(tmpdir(), "zlogin-cli-source-"));
	const archive = join(await mkdtemp(join(tmpdir(), "zlogin-cli-archive-")), "runtime.tar");
	await writeFile(join(source, "runtime-entry.txt"), "runtime-test");
	await execFileAsync("tar", ["-cf", archive, "-C", source, "."]);
	return { source, archive, data: await readFile(archive) };
};

test("validateReleaseManifest rejects non-HTTPS artifact URLs", () => {
	assert.throws(() => validateReleaseManifest({ status: "active", platform: process.platform, arch: process.arch, downloadUrl: "file:///tmp/runtime.tar", sha256: "a".repeat(64), fileSize: 1, signature: "sig", signatureKeyId: "key", runtimeVersion: "0.1.0", protocolVersion: 1, channel: "stable", minApiVersion: "2026-09", minCliVersion: "0.1.0", publishedAt: new Date().toISOString() }), /URL is not trusted/);
});

test("downloads, verifies and atomically installs a signed Runtime archive", async t => {
	const fixture = await makeArchive();
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const manifest = {
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
