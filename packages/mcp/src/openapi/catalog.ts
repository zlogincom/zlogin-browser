import { readFileSync } from "node:fs";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { HttpMethod } from "../types.js";
import type {
	ApiToolDefinition,
	JsonObject,
	OpenApiDocument,
	OpenApiOperation,
	OpenApiParameter,
	OpenApiParameterBinding
} from "./types.js";

const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const SKIPPED_OPERATIONS = new Set(["profileDetail", "profileConnection"]);

const TOOL_NAME_BY_OPERATION: Record<string, string> = {
	status: "check-status",
	context: "get-api-context",
	profileList: "get-browser-list",
	profileStart: "open-browser",
	profileStop: "close-browser",
	profileActive: "get-browser-active",
	profileLocalActive: "get-opened-browser",
	profileShow: "show-browser",
	profileStopAll: "close-all-profiles",
	profileDetailBySelector: "get-browser",
	profileConnectionBySelector: "get-browser-connection",
	profileActiveBatch: "get-browsers-active",
	profileStartBatch: "open-browsers",
	profileStopBatch: "close-browsers",
	capabilities: "get-capabilities",
	profileEnvironmentOptions: "get-browser-environment-options",
	profileCreate: "create-browser",
	profilePatch: "update-browser",
	profilesMove: "move-browsers",
	profilesDelete: "delete-browsers",
	profileTagsReplace: "replace-browser-tags",
	profileProxyBind: "set-browser-proxy",
	profileFingerprint: "get-browser-fingerprint",
	profileFingerprintPatch: "update-browser-fingerprint",
	profileAdvancedSettings: "get-browser-advanced-settings",
	profileAdvancedSettingsPatch: "update-browser-advanced-settings",
	fingerprintUserAgentRandom: "generate-user-agent",
	fingerprintWebGlRandom: "generate-webgl",
	extensionCategoryList: "get-extension-category-list",
	extensionList: "get-extension-list",
	extensionPackageList: "get-extension-package-list",
	extensionPackageCreateWebStore: "create-extension-package",
	extensionPackageStatusPatch: "update-extension-package-status",
	extensionPackageDelete: "delete-extension-package",
	profileExtensions: "get-browser-extensions",
	profileExtensionsPatch: "update-browser-extensions",
	trashProfileList: "get-trash-browser-list",
	trashProfilesRestore: "restore-browsers",
	trashProfilesDelete: "purge-browsers",
	profileCookies: "get-browser-cookies",
	profileCookiesReplace: "replace-browser-cookies",
	profileCookiesPatch: "update-browser-cookies",
	accountPlatformList: "get-account-platform-list",
	profileAccounts: "get-browser-accounts",
	profileAccountsReplace: "replace-browser-accounts",
	profileAccountsPatch: "update-browser-accounts",
	profileStartupPages: "get-browser-startup-pages",
	profileStartupPagesReplace: "replace-browser-startup-pages",
	profileStartupPagesPatch: "update-browser-startup-pages",
	profileGroupList: "get-group-list",
	profileGroupCreate: "create-group",
	profileGroupPatch: "update-group",
	profileGroupDelete: "delete-group",
	profileGroupMerge: "merge-groups",
	profileGroupPin: "pin-group",
	profileGroupUnpin: "unpin-group",
	profileTagList: "get-tag-list",
	profileTagCreate: "create-tag",
	profileTagPatch: "update-tag",
	profileTagDelete: "delete-tags",
	proxyList: "get-proxy-list",
	proxyCreate: "create-proxies",
	proxyDetail: "get-proxy",
	proxyPatch: "update-proxy",
	proxyDelete: "delete-proxies",
	proxyCheck: "check-proxy",
	proxyTagList: "get-proxy-tag-list",
	proxyTagCreate: "create-proxy-tag",
	proxyTagPatch: "update-proxy-tag",
	proxyTagDelete: "delete-proxy-tags",
	browserPackageList: "get-kernel-list",
	browserPackageDownloadCreate: "download-kernel",
	browserPackageDownloadStatus: "get-kernel-task",
	browserPackageInstall: "install-kernel",
	browserPackageDelete: "delete-kernel"
};

const TOOL_INTENT_BY_OPERATION: Record<string, string> = {
	status: "Check whether the ZLogin Local Open API is available.",
	profileList: "List or search browser profiles with pagination and filters.",
	profileStart: "Start an existing ZLogin browser profile and return its CDP connection.",
	profileStop: "Stop one running ZLogin browser profile.",
	profileCreate: "Create a new ZLogin browser profile.",
	profilePatch: "Update the basic configuration of an existing browser profile.",
	profilesDelete: "Move browser profiles to the ZLogin trash.",
	profileCookies: "Read the cookies of one browser profile.",
	profileGroupList: "List ZLogin browser profile groups.",
	proxyList: "List saved proxy configurations without returning proxy passwords.",
	proxyCheck: "Check a saved or inline proxy from the local device.",
	browserPackageList: "List browser kernel packages available on this device."
};

const READ_ONLY_OPERATIONS = new Set([
	"status",
	"context",
	"profileList",
	"profileDetail",
	"profileActive",
	"profileLocalActive",
	"profileConnection",
	"profileDetailBySelector",
	"profileConnectionBySelector",
	"profileActiveBatch",
	"capabilities",
	"profileEnvironmentOptions",
	"profileFingerprint",
	"profileAdvancedSettings",
	"fingerprintUserAgentRandom",
	"fingerprintWebGlRandom",
	"extensionCategoryList",
	"extensionList",
	"extensionPackageList",
	"profileExtensions",
	"trashProfileList",
	"profileCookies",
	"accountPlatformList",
	"profileAccounts",
	"profileStartupPages",
	"profileGroupList",
	"profileTagList",
	"proxyList",
	"proxyDetail",
	"proxyCheck",
	"proxyTagList",
	"browserPackageList",
	"browserPackageDownloadStatus"
]);

const DESTRUCTIVE_OPERATIONS = new Set([
	"profileStop",
	"profileStopAll",
	"profileStopBatch",
	"profilesDelete",
	"extensionPackageDelete",
	"trashProfilesDelete",
	"profileGroupDelete",
	"profileTagDelete",
	"proxyDelete",
	"proxyTagDelete",
	"browserPackageDelete"
]);

const clone = <T>(value: T): T => structuredClone(value);

const getReferenceName = (value: unknown, section: string): string | null => {
	if (typeof value !== "string") return null;
	const prefix = `#/components/${section}/`;
	return value.startsWith(prefix) ? value.slice(prefix.length) : null;
};

const resolveParameter = (document: OpenApiDocument, parameter: OpenApiParameter): OpenApiParameter => {
	const name = getReferenceName(parameter.$ref, "parameters");
	if (!name) return parameter;
	const resolved = document.components?.parameters?.[name];
	if (!resolved) throw new Error(`OpenAPI parameter reference is missing: ${parameter.$ref}`);
	return resolved;
};

const resolveRootSchema = (document: OpenApiDocument, schema: JsonObject): JsonObject => {
	const name = getReferenceName(schema.$ref, "schemas");
	if (!name) return clone(schema);
	const resolved = document.components?.schemas?.[name];
	if (!resolved) throw new Error(`OpenAPI schema reference is missing: ${schema.$ref}`);
	return clone(resolved);
};

const collectTopLevelPropertyNames = (document: OpenApiDocument, schema: JsonObject): Set<string> => {
	const resolved = resolveRootSchema(document, schema);
	const names = new Set<string>();
	if (resolved.properties && typeof resolved.properties === "object") {
		for (const name of Object.keys(resolved.properties as JsonObject)) names.add(name);
	}
	for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
		const branches = resolved[keyword];
		if (!Array.isArray(branches)) continue;
		for (const branch of branches) {
			if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue;
			for (const name of collectTopLevelPropertyNames(document, branch as JsonObject)) names.add(name);
		}
	}
	return names;
};

interface ExtraInputProperty {
	name: string;
	required: boolean;
	schema: JsonObject;
}

const addExtraProperties = (
	document: OpenApiDocument,
	schema: JsonObject,
	extras: ExtraInputProperty[]
): JsonObject => {
	const resolved = resolveRootSchema(document, schema);
	for (const keyword of ["oneOf", "anyOf"] as const) {
		const branches = resolved[keyword];
		if (Array.isArray(branches)) {
			return {
				...resolved,
				[keyword]: branches.map((branch) =>
					branch && typeof branch === "object" && !Array.isArray(branch)
						? addExtraProperties(document, branch as JsonObject, extras)
						: branch
				)
			};
		}
	}

	if (resolved.type !== "object") return resolved;
	const bodyProperties = { ...((resolved.properties as JsonObject | undefined) ?? {}) };
	const properties = { ...bodyProperties };
	const required = new Set(
		Array.isArray(resolved.required) ? resolved.required.filter((item) => typeof item === "string") : []
	);
	for (const extra of extras) {
		properties[extra.name] = clone(extra.schema);
		if (extra.required) required.add(extra.name);
	}
	return {
		...resolved,
		properties,
		...(required.size > 0 ? { required: [...required] } : {}),
		...(resolved.minProperties === 1 && Object.keys(bodyProperties).length > 0
			? {
					allOf: [
						...(Array.isArray(resolved.allOf) ? resolved.allOf : []),
						{ anyOf: Object.keys(bodyProperties).map((name) => ({ required: [name] })) }
					]
				}
			: {})
	};
};

const rewriteReferences = (schema: unknown, referencedNames: Set<string>): unknown => {
	if (Array.isArray(schema)) return schema.map((item) => rewriteReferences(item, referencedNames));
	if (!schema || typeof schema !== "object") return schema;
	const output: JsonObject = {};
	for (const [key, value] of Object.entries(schema as JsonObject)) {
		if (key === "$ref") {
			const name = getReferenceName(value, "schemas");
			if (name) {
				referencedNames.add(name);
				output.$ref = `#/$defs/${name}`;
				continue;
			}
		}
		output[key] = rewriteReferences(value, referencedNames);
	}
	return output;
};

const addDefinitions = (document: OpenApiDocument, rootSchema: JsonObject): JsonObject => {
	const pending = new Set<string>();
	const transformed = rewriteReferences(rootSchema, pending) as JsonObject;
	const definitions: JsonObject = {};
	const completed = new Set<string>();

	while (pending.size > 0) {
		const name = pending.values().next().value as string;
		pending.delete(name);
		if (completed.has(name)) continue;
		const source = document.components?.schemas?.[name];
		if (!source) throw new Error(`OpenAPI schema definition is missing: ${name}`);
		completed.add(name);
		definitions[name] = rewriteReferences(source, pending);
	}

	return Object.keys(definitions).length > 0 ? { ...transformed, $defs: definitions } : transformed;
};

const parameterInputName = (parameter: OpenApiParameter): string => {
	if (parameter.name === "Idempotency-Key") return "idempotencyKey";
	if (parameter.name === "If-Match") return "ifMatch";
	return parameter.name ?? "";
};

const createAnnotations = (operationId: string, method: HttpMethod, hasIdempotencyKey: boolean): ToolAnnotations => {
	const readOnly = READ_ONLY_OPERATIONS.has(operationId);
	return {
		readOnlyHint: readOnly,
		destructiveHint: DESTRUCTIVE_OPERATIONS.has(operationId),
		idempotentHint:
			readOnly ||
			method === "GET" ||
			hasIdempotencyKey ||
			["profileStart", "profileStop", "profileShow"].includes(operationId),
		openWorldHint: !readOnly || operationId === "proxyCheck"
	};
};

const camelToKebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const createApiTool = (
	document: OpenApiDocument,
	path: string,
	method: HttpMethod,
	pathItem: JsonObject,
	operation: OpenApiOperation
): ApiToolDefinition | null => {
	const operationId = operation.operationId;
	if (!operationId || SKIPPED_OPERATIONS.has(operationId)) return null;

	const rawParameters = [
		...(Array.isArray(pathItem.parameters) ? (pathItem.parameters as OpenApiParameter[]) : []),
		...(Array.isArray(operation.parameters) ? operation.parameters : [])
	];
	const parameters = rawParameters
		.map((parameter) => resolveParameter(document, parameter))
		.filter((parameter) => parameter.name && parameter.in);
	const extras: ExtraInputProperty[] = parameters.map((parameter) => ({
		name: parameterInputName(parameter),
		required: parameter.required === true,
		schema: clone(parameter.schema ?? { type: "string" })
	}));
	const parameterBindings: OpenApiParameterBinding[] = parameters.map((parameter) => ({
		inputName: parameterInputName(parameter),
		wireName: parameter.name!,
		location: parameter.in!
	}));

	const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
	const resolvedBody = bodySchema ? resolveRootSchema(document, bodySchema) : null;
	const bodyIsObject =
		resolvedBody?.type === "object" || Array.isArray(resolvedBody?.oneOf) || Array.isArray(resolvedBody?.anyOf);
	let bodyMode: ApiToolDefinition["bodyMode"] = "none";
	let bodyInputNames: string[] = [];
	let inputSchema: JsonObject;

	if (resolvedBody && bodyIsObject) {
		bodyMode = "flat";
		bodyInputNames = [...collectTopLevelPropertyNames(document, resolvedBody)];
		inputSchema = addExtraProperties(document, resolvedBody, extras);
	} else if (resolvedBody) {
		bodyMode = "wrapped";
		const required = extras.filter((extra) => extra.required).map((extra) => extra.name);
		if (operation.requestBody?.required) required.push("body");
		inputSchema = {
			type: "object",
			additionalProperties: false,
			properties: Object.fromEntries([
				...extras.map((extra) => [extra.name, extra.schema]),
				["body", resolvedBody]
			]),
			...(required.length > 0 ? { required } : {})
		};
	} else {
		const required = extras.filter((extra) => extra.required).map((extra) => extra.name);
		inputSchema = {
			type: "object",
			additionalProperties: false,
			properties: Object.fromEntries(extras.map((extra) => [extra.name, extra.schema])),
			...(required.length > 0 ? { required } : {})
		};
	}

	const name = TOOL_NAME_BY_OPERATION[operationId] ?? camelToKebab(operationId);
	const summary = operation.summary ?? operationId;
	const description = `${TOOL_INTENT_BY_OPERATION[operationId] ?? `Call the ZLogin ${name} capability.`} / ${summary}`;
	const hasIdempotencyKey = parameters.some((parameter) => parameter.name === "Idempotency-Key");
	const auth = Array.isArray(operation.security) && operation.security.length > 0;
	inputSchema = { ...inputSchema, type: "object" };

	return {
		kind: "api",
		routeId: operationId,
		method,
		path,
		auth,
		parameterBindings,
		bodyMode,
		bodyInputNames,
		bodyRequired: operation.requestBody?.required === true,
		tool: {
			name,
			title: summary,
			description,
			inputSchema: addDefinitions(document, inputSchema) as Tool["inputSchema"],
			annotations: createAnnotations(operationId, method, hasIdempotencyKey)
		}
	};
};

export const loadApiToolCatalog = (): ApiToolDefinition[] => {
	const source = readFileSync(new URL("../../assets/openapi.json", import.meta.url), "utf8");
	const document = JSON.parse(source) as OpenApiDocument;
	const tools: ApiToolDefinition[] = [];

	for (const [path, rawPathItem] of Object.entries(document.paths)) {
		const pathItem = rawPathItem as JsonObject;
		for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
			const method = rawMethod.toUpperCase() as HttpMethod;
			if (
				!HTTP_METHODS.has(method) ||
				!rawOperation ||
				typeof rawOperation !== "object" ||
				Array.isArray(rawOperation)
			)
				continue;
			const tool = createApiTool(document, path, method, pathItem, rawOperation as OpenApiOperation);
			if (tool) tools.push(tool);
		}
	}

	const names = new Set<string>();
	for (const definition of tools) {
		if (names.has(definition.tool.name))
			throw new Error(`Duplicate MCP tool name generated: ${definition.tool.name}`);
		names.add(definition.tool.name);
	}
	return tools;
};
