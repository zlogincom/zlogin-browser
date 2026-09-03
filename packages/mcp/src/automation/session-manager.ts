import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { ZLoginClient } from "../client.js";
import type { ZLoginLaunchOverrides, ZLoginProfileSelector, ZLoginResult } from "../types.js";

interface AutomationConnection {
	webSocketDebuggerUrl: string;
}

interface ProfileStartData {
	profileId?: string;
	profileCode?: string;
	runtimeId?: string;
	alreadyRunning?: boolean;
	automation?: AutomationConnection;
}

interface BrowserSession {
	id: string;
	browser: Browser;
	context: BrowserContext;
	activePage: Page | null;
	pageIds: Map<Page, string>;
	profileId: string | null;
	profileCode: string | null;
	runtimeId: string | null;
	alreadyRunning: boolean | null;
	connectedAt: string;
}

export interface BrowserSessionSummary {
	sessionId: string;
	profileId: string | null;
	profileCode: string | null;
	runtimeId: string | null;
	alreadyRunning: boolean | null;
	connectedAt: string;
	pageCount: number;
	activePageId: string | null;
}

export type CdpConnector = (wsUrl: string) => Promise<Browser>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readStartData = (value: unknown): ProfileStartData => {
	if (!isRecord(value)) throw new TypeError("ZLogin returned an invalid browser start result");
	const automation = isRecord(value.automation) ? value.automation : null;
	const wsUrl = automation?.webSocketDebuggerUrl;
	if (typeof wsUrl !== "string" || !wsUrl) throw new TypeError("ZLogin did not return a CDP WebSocket endpoint");
	return {
		...(typeof value.profileId === "string" ? { profileId: value.profileId } : {}),
		...(typeof value.profileCode === "string" ? { profileCode: value.profileCode } : {}),
		...(typeof value.runtimeId === "string" ? { runtimeId: value.runtimeId } : {}),
		...(typeof value.alreadyRunning === "boolean" ? { alreadyRunning: value.alreadyRunning } : {}),
		automation: { webSocketDebuggerUrl: wsUrl }
	};
};

const assertLoopbackWebSocket = (value: string): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("wsUrl must be an absolute WebSocket URL");
	}
	if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new TypeError("wsUrl must use ws or wss");
	const hostname = url.hostname.toLowerCase();
	if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
		throw new TypeError("wsUrl must target the local device");
	}
	return url.href;
};

export class BrowserSessionManager {
	readonly #client: ZLoginClient;
	readonly #connectOverCDP: CdpConnector;
	readonly #sessions = new Map<string, BrowserSession>();
	#activeSessionId: string | null = null;

	constructor(client: ZLoginClient, connectOverCDP: CdpConnector = (wsUrl) => chromium.connectOverCDP(wsUrl)) {
		this.#client = client;
		this.#connectOverCDP = connectOverCDP;
	}

	async connectProfile(
		selector: ZLoginProfileSelector,
		launchOverrides?: ZLoginLaunchOverrides
	): Promise<{ session: BrowserSessionSummary; api: ZLoginResult<unknown> }> {
		const api = await this.#client.startProfile(selector, launchOverrides);
		const data = readStartData(api.data);
		const session = await this.connectWebSocket(data.automation!.webSocketDebuggerUrl, {
			profileId: data.profileId ?? null,
			profileCode: data.profileCode ?? null,
			runtimeId: data.runtimeId ?? null,
			alreadyRunning: data.alreadyRunning ?? null
		});
		return { session, api };
	}

	async connectWebSocket(
		wsUrl: string,
		metadata: {
			profileId?: string | null;
			profileCode?: string | null;
			runtimeId?: string | null;
			alreadyRunning?: boolean | null;
		} = {}
	): Promise<BrowserSessionSummary> {
		const normalizedUrl = assertLoopbackWebSocket(wsUrl);
		const existing = metadata.runtimeId
			? [...this.#sessions.values()].find(
					(session) => session.runtimeId === metadata.runtimeId && session.browser.isConnected()
				)
			: undefined;
		if (existing) {
			this.#activeSessionId = existing.id;
			return this.toSummary(existing);
		}

		const browser = await this.#connectOverCDP(normalizedUrl);
		const context = browser.contexts()[0];
		if (!context) throw new Error("The connected ZLogin browser does not expose a default context");
		const activePage = context.pages()[0] ?? (await context.newPage());
		const id = randomUUID();
		const session: BrowserSession = {
			id,
			browser,
			context,
			activePage,
			pageIds: new Map([[activePage, randomUUID()]]),
			profileId: metadata.profileId ?? null,
			profileCode: metadata.profileCode ?? null,
			runtimeId: metadata.runtimeId ?? null,
			alreadyRunning: metadata.alreadyRunning ?? null,
			connectedAt: new Date().toISOString()
		};
		for (const page of context.pages()) this.ensurePageId(session, page);
		browser.on("disconnected", () => {
			this.#sessions.delete(id);
			if (this.#activeSessionId === id) this.#activeSessionId = this.#sessions.keys().next().value ?? null;
		});
		this.#sessions.set(id, session);
		this.#activeSessionId = id;
		return this.toSummary(session);
	}

	listSessions(): BrowserSessionSummary[] {
		return [...this.#sessions.values()]
			.filter((session) => session.browser.isConnected())
			.map((session) => this.toSummary(session));
	}

	selectSession(sessionId: string): BrowserSessionSummary {
		const session = this.getSession(sessionId);
		this.#activeSessionId = session.id;
		return this.toSummary(session);
	}

	private getSession(sessionId?: string): BrowserSession {
		const resolvedId = sessionId ?? this.#activeSessionId;
		if (!resolvedId) throw new TypeError("No browser session is connected; call connect-browser first");
		const session = this.#sessions.get(resolvedId);
		if (!session || !session.browser.isConnected())
			throw new TypeError(`Browser session is not available: ${resolvedId}`);
		return session;
	}

	getPage(sessionId?: string): Page {
		const session = this.getSession(sessionId);
		if (!session.activePage || session.activePage.isClosed()) {
			session.activePage = session.context.pages().find((page) => !page.isClosed()) ?? null;
		}
		if (!session.activePage) throw new TypeError("The browser session has no open page; call open-new-page first");
		return session.activePage;
	}

	async listPages(sessionId?: string) {
		const session = this.getSession(sessionId);
		return Promise.all(
			session.context.pages().map(async (page, index) => ({
				pageId: this.ensurePageId(session, page),
				index,
				title: await page.title().catch(() => ""),
				url: page.url(),
				active: page === session.activePage
			}))
		);
	}

	async selectPage(pageId: string, sessionId?: string) {
		const session = this.getSession(sessionId);
		const page = [...session.pageIds.entries()].find(([, id]) => id === pageId)?.[0];
		if (!page || page.isClosed()) throw new TypeError(`Page is not available: ${pageId}`);
		session.activePage = page;
		await page.bringToFront();
		return { pageId, title: await page.title(), url: page.url() };
	}

	async openPage(url?: string, sessionId?: string) {
		const session = this.getSession(sessionId);
		const page = await session.context.newPage();
		session.activePage = page;
		const pageId = this.ensurePageId(session, page);
		if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
		return { pageId, title: await page.title(), url: page.url() };
	}

	async closePage(pageId: string | undefined, sessionId?: string) {
		const session = this.getSession(sessionId);
		const page = pageId ? [...session.pageIds.entries()].find(([, id]) => id === pageId)?.[0] : session.activePage;
		if (!page || page.isClosed()) throw new TypeError(`Page is not available: ${pageId ?? "active"}`);
		const closedPageId = this.ensurePageId(session, page);
		await page.close();
		session.pageIds.delete(page);
		const replacement = session.context.pages().find((candidate) => !candidate.isClosed());
		session.activePage = replacement ?? null;
		return {
			pageId: closedPageId,
			remainingPages: session.context.pages().filter((candidate) => !candidate.isClosed()).length
		};
	}

	private ensurePageId(session: BrowserSession, page: Page): string {
		const existing = session.pageIds.get(page);
		if (existing) return existing;
		const id = randomUUID();
		session.pageIds.set(page, id);
		page.once("close", () => session.pageIds.delete(page));
		return id;
	}

	private toSummary(session: BrowserSession): BrowserSessionSummary {
		if (!session.activePage || session.activePage.isClosed()) {
			session.activePage = session.context.pages().find((page) => !page.isClosed()) ?? null;
		}
		return {
			sessionId: session.id,
			profileId: session.profileId,
			profileCode: session.profileCode,
			runtimeId: session.runtimeId,
			alreadyRunning: session.alreadyRunning,
			connectedAt: session.connectedAt,
			pageCount: session.context.pages().filter((page) => !page.isClosed()).length,
			activePageId: session.activePage ? this.ensurePageId(session, session.activePage) : null
		};
	}
}
