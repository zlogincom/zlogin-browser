import type { ZLoginClient } from "../client.js";
import { apiSuccessResult } from "../tool-result.js";
import type { QueryValue, ZLoginRequestOptions } from "../types.js";
import type { ApiToolDefinition, JsonObject } from "./types.js";

const hasOwn = (value: JsonObject, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export const executeApiTool = async (
	definition: ApiToolDefinition,
	argumentsValue: JsonObject,
	client: ZLoginClient
) => {
	const path: Record<string, string | number> = {};
	const query: Record<string, QueryValue> = {};
	let idempotencyKey: string | undefined;
	let ifMatch: string | undefined;

	for (const binding of definition.parameterBindings) {
		const value = argumentsValue[binding.inputName];
		if (value === undefined || value === null) continue;
		if (binding.location === "path") path[binding.wireName] = value as string | number;
		else if (binding.location === "query") query[binding.wireName] = value as QueryValue;
		else if (binding.wireName === "Idempotency-Key") idempotencyKey = String(value);
		else if (binding.wireName === "If-Match") ifMatch = String(value);
	}

	let body: unknown;
	if (definition.bodyMode === "wrapped") body = argumentsValue.body;
	else if (definition.bodyMode === "flat") {
		const bodyObject = Object.fromEntries(
			definition.bodyInputNames
				.filter((name) => hasOwn(argumentsValue, name))
				.map((name) => [name, argumentsValue[name]])
		);
		if (definition.bodyRequired || Object.keys(bodyObject).length > 0) body = bodyObject;
	}

	const options: ZLoginRequestOptions = {
		auth: definition.auth,
		...(Object.keys(path).length > 0 ? { path } : {}),
		...(Object.keys(query).length > 0 ? { query } : {}),
		...(body !== undefined ? { body } : {}),
		...(idempotencyKey ? { idempotencyKey } : {}),
		...(ifMatch ? { ifMatch } : {})
	};
	return apiSuccessResult(await client.request(definition.method, definition.path, options));
};
