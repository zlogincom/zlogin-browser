import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { BrowserSessionManager, type CdpConnector } from "../src/automation/session-manager.js";
import { ZLoginClient } from "../src/client.js";

const client = new ZLoginClient({
	apiKey: "test-key",
	baseUrl: "http://127.0.0.1:50025",
	timeoutMs: 1_000,
	fetch: async () => new Response()
});

const createBrowser = (): Browser => {
	const pages: Page[] = [];

	const createPage = (): Page => {
		let closed = false;
		const closeListeners: Array<() => void> = [];
		const page = {
			title: async () => "Test page",
			url: () => "about:blank",
			isClosed: () => closed,
			bringToFront: async () => undefined,
			close: async () => {
				closed = true;
				for (const listener of closeListeners) listener();
			},
			once: (event: string, listener: () => void) => {
				if (event === "close") closeListeners.push(listener);
				return page;
			}
		};
		return page as unknown as Page;
	};

	pages.push(createPage());
	const context = {
		pages: () => pages.filter((page) => !page.isClosed()),
		newPage: async () => {
			const page = createPage();
			pages.push(page);
			return page;
		}
	} as unknown as BrowserContext;

	const disconnectListeners: Array<() => void> = [];
	return {
		contexts: () => [context],
		isConnected: () => true,
		on: (event: string, listener: () => void) => {
			if (event === "disconnected") disconnectListeners.push(listener);
		}
	} as unknown as Browser;
};

test("browser sessions can recover after their last page is closed", async () => {
	const connect: CdpConnector = async () => createBrowser();
	const sessions = new BrowserSessionManager(client, connect);
	const connected = await sessions.connectWebSocket("ws://127.0.0.1:9222/devtools/browser/test");
	assert.equal(connected.pageCount, 1);
	assert.ok(connected.activePageId);

	const [page] = await sessions.listPages();
	assert.ok(page);
	const closed = await sessions.closePage(page.pageId);
	assert.equal(closed.remainingPages, 0);
	assert.equal(sessions.listSessions()[0]?.activePageId, null);
	assert.deepEqual(await sessions.listPages(), []);

	const opened = await sessions.openPage();
	assert.ok(opened.pageId);
	assert.equal(sessions.listSessions()[0]?.pageCount, 1);
});

test("direct CDP connection rejects non-loopback endpoints", async () => {
	let called = false;
	const connect: CdpConnector = async () => {
		called = true;
		return createBrowser();
	};
	const sessions = new BrowserSessionManager(client, connect);
	await assert.rejects(
		sessions.connectWebSocket("ws://example.com/devtools/browser/test"),
		/must target the local device/
	);
	assert.equal(called, false);
});
