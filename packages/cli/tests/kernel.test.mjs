import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureKernel, getKernelDownloadStatus, listKernels } from "../dist/kernel.js";

test("kernel commands use the authenticated Runtime control protocol", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-kernel-"));
	const version = "0.1.0-test";
	const token = "test-runtime-token-123456789";
	const requests = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push({ method: request.method, url: request.url, token: request.headers["x-zlogin-runtime-token"], body: body ? JSON.parse(body) : null });
		response.setHeader("content-type", "application/json");
		if (request.headers["x-zlogin-runtime-token"] !== token) response.writeHead(401).end(JSON.stringify({ message: "Unauthorized" }));
		else if (request.url === "/health") response.writeHead(200).end(JSON.stringify({ ok: true, protocolVersion: 1, runtimeVersion: version }));
		else if (request.url === "/kernel/list") response.writeHead(200).end(JSON.stringify({ items: [{ browserVersion: "130", buildVersion: "1", installed: true, inUse: false }] }));
		else if (request.url === "/kernel/ensure") response.writeHead(200).end(JSON.stringify({ status: "downloading", browserVersion: "131", taskId: "task-1" }));
		else if (request.url === "/kernel/download/status/task-1") response.writeHead(200).end(JSON.stringify({ taskId: "task-1", status: "running", progress: 50 }));
		else response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
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
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME; else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
	});
	assert.equal((await listKernels()).items[0].browserVersion, "130");
	assert.equal((await ensureKernel("131")).taskId, "task-1");
	assert.deepEqual(await getKernelDownloadStatus("task-1"), { taskId: "task-1", status: "running", progress: 50 });
	assert.ok(requests.every(request => request.token === token));
	assert.deepEqual(requests.find(request => request.url === "/kernel/ensure").body, { browserVersion: "131" });
});
