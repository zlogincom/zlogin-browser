import assert from "node:assert/strict";
import test from "node:test";
import { loadApiToolCatalog } from "../src/openapi/catalog.js";

test("OpenAPI catalog maps supported operations to stable friendly tool names", () => {
	const catalog = loadApiToolCatalog();
	assert.equal(catalog.length, 75);
	assert.equal(new Set(catalog.map((definition) => definition.tool.name)).size, catalog.length);
	assert.equal(
		catalog.some((definition) => definition.routeId === "profileDetail"),
		false
	);
	assert.equal(
		catalog.some((definition) => definition.routeId === "profileConnection"),
		false
	);

	const create = catalog.find((definition) => definition.tool.name === "create-browser");
	assert.equal(create?.routeId, "profileCreate");
	assert.ok(
		create?.parameterBindings.some(
			(binding) => binding.inputName === "idempotencyKey" && binding.wireName === "Idempotency-Key"
		)
	);

	const update = catalog.find((definition) => definition.tool.name === "update-browser");
	assert.ok(
		update?.parameterBindings.some((binding) => binding.inputName === "ifMatch" && binding.wireName === "If-Match")
	);

	const cookies = catalog.find((definition) => definition.tool.name === "replace-browser-cookies");
	assert.equal(cookies?.bodyMode, "wrapped");
	assert.ok(Object.hasOwn(cookies?.tool.inputSchema.properties ?? {}, "body"));
});
