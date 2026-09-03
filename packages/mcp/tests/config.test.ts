import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig applies safe defaults", () => {
	const config = loadConfig({ ZLOGIN_API_KEY: "  test-key  " });

	assert.deepEqual(config, {
		apiKey: "test-key",
		baseUrl: "http://127.0.0.1:50025",
		timeoutMs: 60_000,
		enableAutomation: true
	});
});

test("loadConfig requires an API key", () => {
	assert.throws(() => loadConfig({}), /ZLOGIN_API_KEY is required/);
});

test("loadConfig parses explicit settings", () => {
	const config = loadConfig({
		ZLOGIN_API_KEY: "test-key",
		ZLOGIN_BASE_URL: "https://zlogin.example.test/local/",
		ZLOGIN_TIMEOUT_MS: "120000",
		ZLOGIN_ENABLE_AUTOMATION: "0"
	});

	assert.equal(config.baseUrl, "https://zlogin.example.test/local");
	assert.equal(config.timeoutMs, 120_000);
	assert.equal(config.enableAutomation, false);
});

test("loadConfig rejects ambiguous or unsafe values", () => {
	assert.throws(
		() => loadConfig({ ZLOGIN_API_KEY: "test-key", ZLOGIN_BASE_URL: "file:///tmp/zlogin" }),
		/must use HTTP or HTTPS/
	);
	assert.throws(
		() => loadConfig({ ZLOGIN_API_KEY: "test-key", ZLOGIN_BASE_URL: "https://user:pass@example.test" }),
		/must not contain credentials/
	);
	assert.throws(
		() => loadConfig({ ZLOGIN_API_KEY: "test-key", ZLOGIN_ENABLE_AUTOMATION: "yes" }),
		/must be true, false, 1, or 0/
	);
});
