import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("runtime status output never exposes the local control token", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-output-"));
	const token = "secret-control-token-123456789";
	const server = createServer((request, response) => {
		if (request.headers["x-zlogin-runtime-token"] !== token) {
			response.writeHead(401).end();
			return;
		}
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: "0.1.0" }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await writeFile(join(home, "endpoint.json"), JSON.stringify({
		pid: process.pid,
		version: "0.1.0",
		port,
		token,
		healthUrl: `http://127.0.0.1:${port}/health`,
		startedAt: new Date().toISOString()
	}));
	t.after(async () => {
		server.close();
		await rm(home, { recursive: true, force: true });
	});

	const output = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url)), "runtime", "status", "--json"], {
			env: { ...process.env, ZLOGIN_RUNTIME_HOME: home },
			windowsHide: true
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", chunk => stdout.push(chunk));
		child.stderr.on("data", chunk => stderr.push(chunk));
		child.on("error", reject);
		child.on("exit", code => code === 0
			? resolve(Buffer.concat(stdout).toString("utf8"))
			: reject(new Error(Buffer.concat(stderr).toString("utf8"))));
	});
	const result = JSON.parse(output);
	assert.equal(result.status, "running");
	assert.equal(result.endpoint.port, port);
	assert.equal("token" in result.endpoint, false);
	assert.doesNotMatch(output, /secret-control-token/);
});
