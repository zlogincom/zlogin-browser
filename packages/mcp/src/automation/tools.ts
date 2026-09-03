import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "playwright-core";
import { successResult } from "../tool-result.js";
import type { ZLoginLaunchOverrides, ZLoginProfileSelector } from "../types.js";
import type { JsonObject } from "../openapi/types.js";
import { BrowserSessionManager } from "./session-manager.js";

export interface AutomationToolDefinition {
	kind: "automation";
	tool: Tool;
	execute(argumentsValue: JsonObject): Promise<CallToolResult>;
}

const MAX_TEXT_CHARS = 100_000;
const MAX_HTML_CHARS = 250_000;
const MAX_SCRIPT_RESULT_CHARS = 100_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const stringSchema = (description: string, maxLength = 2_000): JsonObject => ({
	type: "string",
	minLength: 1,
	maxLength,
	description
});

const objectSchema = (
	properties: Record<string, object>,
	required: string[] = [],
	extra: JsonObject = {}
): Tool["inputSchema"] => ({
	type: "object",
	additionalProperties: false,
	properties,
	...(required.length > 0 ? { required } : {}),
	...extra
});

const sessionProperty = {
	type: "string",
	format: "uuid",
	description: "Browser session ID. Omit to use the active session."
};

const timeoutProperty = {
	type: "integer",
	minimum: 100,
	maximum: 120_000,
	default: 30_000,
	description: "Action timeout in milliseconds."
};

const selectorProperties: Record<string, object> = {
	profileId: {
		anyOf: [
			{ type: "string", minLength: 1 },
			{ type: "integer", minimum: 1 }
		]
	},
	profileNo: {
		anyOf: [
			{ type: "string", minLength: 1 },
			{ type: "integer", minimum: 1 }
		]
	},
	profileCode: stringSchema("Stable ZLogin profile code", 200)
};

const exactlyOneSelector: JsonObject = {
	oneOf: [
		{
			required: ["profileId"],
			not: { anyOf: [{ required: ["profileNo"] }, { required: ["profileCode"] }] }
		},
		{
			required: ["profileNo"],
			not: { anyOf: [{ required: ["profileId"] }, { required: ["profileCode"] }] }
		},
		{
			required: ["profileCode"],
			not: { anyOf: [{ required: ["profileId"] }, { required: ["profileNo"] }] }
		}
	]
};

const readAnnotations: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true
};

const actionAnnotations: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true
};

const destructiveAnnotations: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true
};

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const requiredString = (value: unknown, name: string): string => {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
	return value;
};

const stringValue = (value: unknown, name: string): string => {
	if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
	return value;
};

const optionalNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toSelector = (input: JsonObject): ZLoginProfileSelector => {
	const selector: ZLoginProfileSelector = {
		...(typeof input.profileId === "string" || typeof input.profileId === "number"
			? { profileId: input.profileId }
			: {}),
		...(typeof input.profileNo === "string" || typeof input.profileNo === "number"
			? { profileNo: input.profileNo }
			: {}),
		...(typeof input.profileCode === "string" ? { profileCode: input.profileCode } : {})
	};
	if (Object.keys(selector).length !== 1) {
		throw new TypeError("Provide exactly one of profileId, profileNo, or profileCode");
	}
	return selector;
};

const assertHttpUrl = (value: string): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("url must be an absolute HTTP(S) URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("url must use HTTP or HTTPS");
	}
	return url.href;
};

const pageState = async (page: Page): Promise<Record<string, unknown>> => ({
	title: await page.title().catch(() => ""),
	url: page.url()
});

const truncateText = (value: string, maxChars: number): Record<string, unknown> => ({
	text: value.slice(0, maxChars),
	truncated: value.length > maxChars,
	totalChars: value.length
});

const boundedScriptResult = (value: unknown): Record<string, unknown> => {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		return { result: String(value), truncated: false };
	}
	if (serialized === undefined) return { result: null, truncated: false };
	if (serialized.length <= MAX_SCRIPT_RESULT_CHARS) return { result: value, truncated: false };
	return {
		result: serialized.slice(0, MAX_SCRIPT_RESULT_CHARS),
		truncated: true,
		totalChars: serialized.length
	};
};

const define = (
	name: string,
	title: string,
	description: string,
	inputSchema: Tool["inputSchema"],
	annotations: ToolAnnotations,
	execute: AutomationToolDefinition["execute"]
): AutomationToolDefinition => ({
	kind: "automation",
	tool: { name, title, description, inputSchema, annotations },
	execute
});

export const createAutomationToolCatalog = (sessions: BrowserSessionManager): AutomationToolDefinition[] => [
	define(
		"connect-browser",
		"Connect to a ZLogin browser",
		"Start or reuse a ZLogin profile and connect an internal Playwright session to its CDP endpoint.",
		objectSchema(
			{
				...selectorProperties,
				startupUrls: {
					type: "array",
					items: { type: "string", format: "uri", minLength: 1, maxLength: 4_096 },
					maxItems: 20
				},
				windowMode: {
					type: "string",
					enum: ["inherit", "top-left", "last-position", "minimized", "maximized"]
				}
			},
			[],
			exactlyOneSelector
		),
		actionAnnotations,
		async (input) => {
			const startupUrls = Array.isArray(input.startupUrls)
				? input.startupUrls.map((value) => assertHttpUrl(requiredString(value, "startupUrls item")))
				: undefined;
			const windowMode = optionalString(input.windowMode) as ZLoginLaunchOverrides["windowMode"];
			const launchOverrides: ZLoginLaunchOverrides | undefined =
				startupUrls || windowMode
					? { ...(startupUrls ? { startupUrls } : {}), ...(windowMode ? { windowMode } : {}) }
					: undefined;
			const result = await sessions.connectProfile(toSelector(input), launchOverrides);
			return successResult(result.session, {
				requestId: result.api.requestId,
				etag: result.api.etag,
				rateLimit: result.api.rateLimit
			});
		}
	),
	define(
		"connect-browser-with-ws",
		"Connect with a CDP WebSocket",
		"Connect an internal Playwright session to a loopback CDP WebSocket returned by open-browser.",
		objectSchema({ wsUrl: stringSchema("Loopback ws:// or wss:// CDP endpoint", 4_096) }, ["wsUrl"]),
		actionAnnotations,
		async (input) => successResult(await sessions.connectWebSocket(requiredString(input.wsUrl, "wsUrl")))
	),
	define(
		"get-browser-sessions",
		"List browser sessions",
		"List the ZLogin browser sessions currently connected by this MCP process.",
		objectSchema({}),
		readAnnotations,
		async () => successResult(sessions.listSessions())
	),
	define(
		"select-browser-session",
		"Select a browser session",
		"Make one connected browser session the default for later page tools.",
		objectSchema({ sessionId: sessionProperty }, ["sessionId"]),
		actionAnnotations,
		async (input) => successResult(sessions.selectSession(requiredString(input.sessionId, "sessionId")))
	),
	define(
		"get-page-list",
		"List browser pages",
		"List tabs in a connected browser session with stable page IDs, titles, and URLs.",
		objectSchema({ sessionId: sessionProperty }),
		readAnnotations,
		async (input) => successResult(await sessions.listPages(optionalString(input.sessionId)))
	),
	define(
		"select-page",
		"Select a browser page",
		"Select and bring a browser tab to the foreground.",
		objectSchema({ sessionId: sessionProperty, pageId: stringSchema("Page ID", 100) }, ["pageId"]),
		actionAnnotations,
		async (input) =>
			successResult(
				await sessions.selectPage(requiredString(input.pageId, "pageId"), optionalString(input.sessionId))
			)
	),
	define(
		"open-new-page",
		"Open a new browser page",
		"Open a new tab, optionally navigating it to an HTTP(S) URL.",
		objectSchema({ sessionId: sessionProperty, url: stringSchema("HTTP(S) URL", 4_096) }),
		actionAnnotations,
		async (input) => {
			const url = optionalString(input.url);
			return successResult(
				await sessions.openPage(url ? assertHttpUrl(url) : undefined, optionalString(input.sessionId))
			);
		}
	),
	define(
		"close-page",
		"Close a browser page",
		"Close a tab. Omit pageId to close the active tab; unsaved page state may be lost.",
		objectSchema({ sessionId: sessionProperty, pageId: stringSchema("Page ID", 100) }),
		destructiveAnnotations,
		async (input) =>
			successResult(await sessions.closePage(optionalString(input.pageId), optionalString(input.sessionId)))
	),
	define(
		"navigate",
		"Navigate the active page",
		"Navigate the active tab to an absolute HTTP(S) URL.",
		objectSchema(
			{
				sessionId: sessionProperty,
				url: stringSchema("HTTP(S) URL", 4_096),
				waitUntil: { type: "string", enum: ["commit", "domcontentloaded", "load", "networkidle"] },
				timeoutMs: timeoutProperty
			},
			["url"]
		),
		actionAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const waitUntil = (optionalString(input.waitUntil) ?? "domcontentloaded") as
				"commit" | "domcontentloaded" | "load" | "networkidle";
			await page.goto(assertHttpUrl(requiredString(input.url, "url")), {
				waitUntil,
				timeout: optionalNumber(input.timeoutMs) ?? 30_000
			});
			return successResult(await pageState(page));
		}
	),
	define(
		"screenshot",
		"Capture a page screenshot",
		"Capture the active tab and return PNG or JPEG image content directly to the MCP client.",
		objectSchema({
			sessionId: sessionProperty,
			fullPage: { type: "boolean", default: false },
			format: { type: "string", enum: ["png", "jpeg"], default: "png" },
			quality: { type: "integer", minimum: 1, maximum: 100 }
		}),
		readAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const format = optionalString(input.format) === "jpeg" ? "jpeg" : "png";
			const quality = optionalNumber(input.quality);
			const data = await page.screenshot({
				type: format,
				fullPage: input.fullPage === true,
				...(format === "jpeg" && quality ? { quality } : {})
			});
			if (data.byteLength > MAX_SCREENSHOT_BYTES) {
				throw new Error(`Screenshot exceeds the ${MAX_SCREENSHOT_BYTES} byte MCP response limit`);
			}
			const state = await pageState(page);
			return {
				content: [{ type: "image", data: data.toString("base64"), mimeType: `image/${format}` }],
				structuredContent: { ok: true, data: { ...state, format, bytes: data.byteLength } }
			};
		}
	),
	define(
		"get-page-visible-text",
		"Read visible page text",
		"Read bounded visible text from the active page or a CSS-selected element.",
		objectSchema({
			sessionId: sessionProperty,
			selector: stringSchema("Optional CSS selector"),
			maxChars: { type: "integer", minimum: 1_000, maximum: MAX_TEXT_CHARS, default: MAX_TEXT_CHARS }
		}),
		readAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const selector = optionalString(input.selector) ?? "body";
			const text = await page.locator(selector).innerText({ timeout: 30_000 });
			return successResult({ ...truncateText(text, optionalNumber(input.maxChars) ?? MAX_TEXT_CHARS), selector });
		}
	),
	define(
		"get-page-html",
		"Read page HTML",
		"Read bounded HTML from the active page or the outer HTML of a CSS-selected element.",
		objectSchema({
			sessionId: sessionProperty,
			selector: stringSchema("Optional CSS selector"),
			maxChars: { type: "integer", minimum: 1_000, maximum: MAX_HTML_CHARS, default: MAX_HTML_CHARS }
		}),
		readAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const selector = optionalString(input.selector);
			const html = selector
				? await page.locator(selector).evaluate((element) => element.outerHTML)
				: await page.content();
			return successResult({
				...truncateText(html, optionalNumber(input.maxChars) ?? MAX_HTML_CHARS),
				selector: selector ?? null
			});
		}
	),
	define(
		"click-element",
		"Click a page element",
		"Click the first element matching a CSS selector in the active page.",
		objectSchema(
			{
				sessionId: sessionProperty,
				selector: stringSchema("CSS selector"),
				button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
				clickCount: { type: "integer", minimum: 1, maximum: 3, default: 1 },
				timeoutMs: timeoutProperty
			},
			["selector"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			await page
				.locator(requiredString(input.selector, "selector"))
				.first()
				.click({
					button: (optionalString(input.button) ?? "left") as "left" | "right" | "middle",
					clickCount: optionalNumber(input.clickCount) ?? 1,
					timeout: optionalNumber(input.timeoutMs) ?? 30_000
				});
			return successResult(await pageState(page));
		}
	),
	define(
		"fill-input",
		"Fill a page input",
		"Replace the value of the first input matching a CSS selector. The supplied value is never echoed.",
		objectSchema(
			{
				sessionId: sessionProperty,
				selector: stringSchema("CSS selector"),
				value: { type: "string", maxLength: 100_000 },
				timeoutMs: timeoutProperty
			},
			["selector", "value"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const value = typeof input.value === "string" ? input.value : "";
			try {
				await page
					.locator(requiredString(input.selector, "selector"))
					.first()
					.fill(value, {
						timeout: optionalNumber(input.timeoutMs) ?? 30_000
					});
			} catch {
				throw new Error("Unable to fill the selected input");
			}
			return successResult({ filled: true, characterCount: value.length, ...(await pageState(page)) });
		}
	),
	define(
		"select-option",
		"Select an option",
		"Select one or more option values in a CSS-selected select element.",
		objectSchema(
			{
				sessionId: sessionProperty,
				selector: stringSchema("CSS selector"),
				values: {
					oneOf: [
						{ type: "string" },
						{ type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 }
					]
				},
				timeoutMs: timeoutProperty
			},
			["selector", "values"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const values = Array.isArray(input.values)
				? input.values.map((value) => stringValue(value, "values item"))
				: stringValue(input.values, "values");
			const selected = await page
				.locator(requiredString(input.selector, "selector"))
				.first()
				.selectOption(values, {
					timeout: optionalNumber(input.timeoutMs) ?? 30_000
				});
			return successResult({ selectedValues: selected, ...(await pageState(page)) });
		}
	),
	define(
		"hover-element",
		"Hover over an element",
		"Move the pointer over the first element matching a CSS selector.",
		objectSchema(
			{ sessionId: sessionProperty, selector: stringSchema("CSS selector"), timeoutMs: timeoutProperty },
			["selector"]
		),
		actionAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			await page
				.locator(requiredString(input.selector, "selector"))
				.first()
				.hover({
					timeout: optionalNumber(input.timeoutMs) ?? 30_000
				});
			return successResult(await pageState(page));
		}
	),
	define(
		"scroll-element",
		"Scroll a page or element",
		"Scroll the window or a CSS-selected scroll container by pixel deltas.",
		objectSchema({
			sessionId: sessionProperty,
			selector: stringSchema("Optional CSS selector"),
			deltaX: { type: "number", minimum: -100_000, maximum: 100_000, default: 0 },
			deltaY: { type: "number", minimum: -100_000, maximum: 100_000, default: 600 }
		}),
		actionAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const deltaX = optionalNumber(input.deltaX) ?? 0;
			const deltaY = optionalNumber(input.deltaY) ?? 600;
			const selector = optionalString(input.selector);
			if (selector) {
				await page
					.locator(selector)
					.first()
					.evaluate((element, delta) => element.scrollBy(delta.x, delta.y), { x: deltaX, y: deltaY });
			} else {
				await page.evaluate((delta) => window.scrollBy(delta.x, delta.y), { x: deltaX, y: deltaY });
			}
			return successResult({ scrolled: true, deltaX, deltaY, selector: selector ?? null });
		}
	),
	define(
		"press-key",
		"Press a keyboard key",
		"Press a Playwright keyboard shortcut on the active page, optionally focused on a CSS-selected element.",
		objectSchema(
			{
				sessionId: sessionProperty,
				selector: stringSchema("Optional CSS selector"),
				key: stringSchema("Playwright key or shortcut such as Enter or Control+A", 200),
				timeoutMs: timeoutProperty
			},
			["key"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const key = requiredString(input.key, "key");
			const selector = optionalString(input.selector);
			if (selector) {
				await page
					.locator(selector)
					.first()
					.press(key, { timeout: optionalNumber(input.timeoutMs) ?? 30_000 });
			} else {
				await page.keyboard.press(key);
			}
			return successResult(await pageState(page));
		}
	),
	define(
		"evaluate-script",
		"Evaluate JavaScript",
		"Evaluate bounded JavaScript in the active page. The serialized result is capped at 100,000 characters.",
		objectSchema(
			{
				sessionId: sessionProperty,
				script: stringSchema("JavaScript expression or function body", 20_000)
			},
			["script"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			const value = await page.evaluate(requiredString(input.script, "script"));
			return successResult(boundedScriptResult(value));
		}
	),
	define(
		"drag-element",
		"Drag an element",
		"Drag the first source element to the first target element using CSS selectors.",
		objectSchema(
			{
				sessionId: sessionProperty,
				sourceSelector: stringSchema("Source CSS selector"),
				targetSelector: stringSchema("Target CSS selector"),
				timeoutMs: timeoutProperty
			},
			["sourceSelector", "targetSelector"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			await page
				.locator(requiredString(input.sourceSelector, "sourceSelector"))
				.first()
				.dragTo(page.locator(requiredString(input.targetSelector, "targetSelector")).first(), {
					timeout: optionalNumber(input.timeoutMs) ?? 30_000
				});
			return successResult(await pageState(page));
		}
	),
	define(
		"iframe-click-element",
		"Click an element in an iframe",
		"Click the first CSS-selected element inside the first iframe matching another CSS selector.",
		objectSchema(
			{
				sessionId: sessionProperty,
				frameSelector: stringSchema("Iframe CSS selector"),
				selector: stringSchema("Element CSS selector inside the iframe"),
				timeoutMs: timeoutProperty
			},
			["frameSelector", "selector"]
		),
		destructiveAnnotations,
		async (input) => {
			const page = sessions.getPage(optionalString(input.sessionId));
			await page
				.frameLocator(requiredString(input.frameSelector, "frameSelector"))
				.locator(requiredString(input.selector, "selector"))
				.first()
				.click({ timeout: optionalNumber(input.timeoutMs) ?? 30_000 });
			return successResult(await pageState(page));
		}
	)
];
