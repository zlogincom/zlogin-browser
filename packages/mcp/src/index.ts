#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ZLoginClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createZLoginMcpServer } from "./server.js";

export { ZLoginClient } from "./client.js";
export { loadConfig } from "./config.js";
export { createZLoginMcpServer } from "./server.js";

export const startZLoginMcpServer = async (): Promise<void> => {
	const config = loadConfig();
	const client = new ZLoginClient({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		timeoutMs: config.timeoutMs
	});
	const server = createZLoginMcpServer(client, config);
	const transport = new StdioServerTransport();

	const shutdown = async (): Promise<void> => {
		await server.close();
		process.exit(0);
	};
	process.once("SIGINT", () => void shutdown());
	process.once("SIGTERM", () => void shutdown());

	await server.connect(transport);
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
	startZLoginMcpServer().catch((error) => {
		const message = error instanceof Error ? error.message : "Unknown startup error";
		console.error(`zlogin-mcp failed to start: ${message}`);
		process.exit(1);
	});
}
