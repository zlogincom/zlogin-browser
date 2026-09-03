import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ZLoginClient } from "../src/client.js";
import { createZLoginMcpServer } from "../src/server.js";
import type { ZLoginMcpConfig } from "../src/types.js";

const response = (data: unknown, requestId = "request-1"): Response =>
	new Response(JSON.stringify({ success: true, code: "OK", message: "ok", requestId, data }), {
		status: 200,
		headers: { "Content-Type": "application/json", "X-Request-Id": requestId }
	});

const createPair = async (enableAutomation: boolean, fetchImplementation: typeof fetch = async () => response({})) => {
	const config: ZLoginMcpConfig = {
		apiKey: "test-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 1_000,
		enableAutomation
	};
	const zloginClient = new ZLoginClient({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		timeoutMs: config.timeoutMs,
		fetch: fetchImplementation
	});
	const server = createZLoginMcpServer(zloginClient, config);
	const client = new Client({ name: "zlogin-mcp-test", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return { client, server };
};

test("the server exposes all 75 unique Open API tools", async () => {
	const { client, server } = await createPair(false);
	try {
		const tools = (await client.listTools()).tools;
		assert.equal(tools.length, 75);
		assert.equal(new Set(tools.map((tool) => tool.name)).size, 75);
		for (const name of [
			"check-status",
			"open-browser",
			"create-browser",
			"get-browser-cookies",
			"get-group-list",
			"get-proxy-list",
			"download-kernel"
		]) {
			assert.ok(
				tools.some((tool) => tool.name === name),
				`missing ${name}`
			);
		}
		assert.equal(tools.find((tool) => tool.name === "purge-browsers")?.annotations?.destructiveHint, true);
		assert.equal(tools.find((tool) => tool.name === "get-browser-list")?.annotations?.readOnlyHint, true);
	} finally {
		await client.close();
		await server.close();
	}
});

test("automation mode adds 21 browser and page tools", async () => {
	const { client, server } = await createPair(true);
	try {
		const tools = (await client.listTools()).tools;
		assert.equal(tools.length, 96);
		for (const name of [
			"connect-browser",
			"connect-browser-with-ws",
			"get-browser-sessions",
			"navigate",
			"screenshot",
			"click-element",
			"fill-input",
			"evaluate-script",
			"iframe-click-element"
		]) {
			assert.ok(
				tools.some((tool) => tool.name === name),
				`missing ${name}`
			);
		}
	} finally {
		await client.close();
		await server.close();
	}
});

test("open-browser follows the native API contract and preserves its CDP result", async () => {
	const fetchImplementation: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		assert.equal(url.pathname, "/api/v1/browser-profiles/start");
		assert.equal(init?.method, "POST");
		assert.deepEqual(JSON.parse(String(init?.body)), { profileCode: "stable-code" });
		return response(
			{
				profileId: "123",
				profileCode: "stable-code",
				runtimeId: "runtime-1",
				alreadyRunning: false,
				automation: {
					protocol: "cdp",
					debuggerAddress: "127.0.0.1:9222",
					webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/session"
				}
			},
			"request-start"
		);
	};
	const { client, server } = await createPair(false, fetchImplementation);
	try {
		const result = await client.callTool({
			name: "open-browser",
			arguments: { profileCode: "stable-code" }
		});
		assert.notEqual(result.isError, true);
		assert.match(JSON.stringify(result), /webSocketDebuggerUrl/);
		assert.match(JSON.stringify(result), /request-start/);
	} finally {
		await client.close();
		await server.close();
	}
});

test("API tools route path, query, header, and flattened body arguments", async () => {
	const requests: Array<{ url: URL; init?: RequestInit }> = [];
	const fetchImplementation: typeof fetch = async (input, init) => {
		requests.push({ url: new URL(String(input)), ...(init ? { init } : {}) });
		return response({ updated: true });
	};
	const { client, server } = await createPair(false, fetchImplementation);
	try {
		const update = await client.callTool({
			name: "update-browser",
			arguments: { profileId: 123, ifMatch: '"profile-123-r1"', name: "Updated" }
		});
		assert.notEqual(update.isError, true);

		const list = await client.callTool({
			name: "get-group-list",
			arguments: { pageNumber: 2, pageSize: 25, keyword: "sales" }
		});
		assert.notEqual(list.isError, true);

		assert.equal(requests[0]?.url.pathname, "/api/v1/profiles/123");
		assert.equal(requests[0]?.init?.method, "PATCH");
		assert.equal(new Headers(requests[0]?.init?.headers).get("If-Match"), '"profile-123-r1"');
		assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { name: "Updated" });

		assert.equal(requests[1]?.url.pathname, "/api/v1/profile-groups");
		assert.equal(requests[1]?.url.searchParams.get("pageNumber"), "2");
		assert.equal(requests[1]?.url.searchParams.get("pageSize"), "25");
		assert.equal(requests[1]?.url.searchParams.get("keyword"), "sales");
		assert.equal(requests[1]?.init?.body, undefined);
	} finally {
		await client.close();
		await server.close();
	}
});

test("tool argument validation rejects missing selectors and empty patch bodies", async () => {
	const { client, server } = await createPair(false);
	try {
		const missing = await client.callTool({ name: "open-browser", arguments: {} });
		assert.equal(missing.isError, true);
		assert.match(JSON.stringify(missing), /INVALID_TOOL_ARGUMENTS/);

		const ambiguous = await client.callTool({
			name: "open-browser",
			arguments: { profileId: 123, profileCode: "stable-code" }
		});
		assert.equal(ambiguous.isError, true);

		const emptyPatch = await client.callTool({
			name: "update-browser",
			arguments: { profileId: 123, ifMatch: '"profile-123-r1"' }
		});
		assert.equal(emptyPatch.isError, true);
	} finally {
		await client.close();
		await server.close();
	}
});
