import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { createRequire } from "node:module";
import { ZLOGIN_AGENT_INSTRUCTIONS, ZLOGIN_MCP_SERVER_NAME, ZLOGIN_MCP_SERVER_VERSION } from "@zlogin/core";
import type { ZLoginClient } from "./client.js";
import { BrowserSessionManager } from "./automation/session-manager.js";
import { createAutomationToolCatalog, type AutomationToolDefinition } from "./automation/tools.js";
import { loadApiToolCatalog } from "./openapi/catalog.js";
import { executeApiTool } from "./openapi/execute.js";
import type { ApiToolDefinition, JsonObject } from "./openapi/types.js";
import { errorResult, validationErrorResult } from "./tool-result.js";
import type { ZLoginMcpConfig } from "./types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

type ToolDefinition = ApiToolDefinition | AutomationToolDefinition;

const formatValidationErrors = (errors: ErrorObject[] | null | undefined): string[] =>
	(errors ?? []).map((error) => {
		const location = error.instancePath || "arguments";
		return `${location} ${error.message ?? "is invalid"}`;
	});

const createValidators = (definitions: ToolDefinition[]): Map<string, ValidateFunction> => {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
	addFormats(ajv);
	return new Map(definitions.map((definition) => [definition.tool.name, ajv.compile(definition.tool.inputSchema)]));
};

const assertUniqueNames = (definitions: ToolDefinition[]): void => {
	const names = new Set<string>();
	for (const definition of definitions) {
		if (names.has(definition.tool.name)) throw new Error(`Duplicate MCP tool name: ${definition.tool.name}`);
		names.add(definition.tool.name);
	}
};

export const createZLoginMcpServer = (client: ZLoginClient, config: ZLoginMcpConfig): Server => {
	const apiTools = loadApiToolCatalog();
	const automationTools = config.enableAutomation
		? createAutomationToolCatalog(new BrowserSessionManager(client))
		: [];
	const definitions: ToolDefinition[] = [...apiTools, ...automationTools];
	assertUniqueNames(definitions);

	const byName = new Map(definitions.map((definition) => [definition.tool.name, definition]));
	const validators = createValidators(definitions);
	const server = new Server(
		{ name: ZLOGIN_MCP_SERVER_NAME, version: ZLOGIN_MCP_SERVER_VERSION },
		{
			capabilities: { tools: {} },
			instructions: ZLOGIN_AGENT_INSTRUCTIONS
		}
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: definitions.map((definition) => definition.tool)
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const definition = byName.get(request.params.name);
		if (!definition) return errorResult(new TypeError(`Unknown tool: ${request.params.name}`));

		const argumentsValue: JsonObject = request.params.arguments ?? {};
		const validate = validators.get(definition.tool.name);
		if (!validate) return errorResult(new Error(`No validator registered for tool: ${definition.tool.name}`));
		if (!validate(argumentsValue)) return validationErrorResult(formatValidationErrors(validate.errors));

		try {
			const result: CallToolResult =
				definition.kind === "api"
					? await executeApiTool(definition, argumentsValue, client)
					: await definition.execute(argumentsValue);
			return result;
		} catch (error) {
			return errorResult(error);
		}
	});

	return server;
};

export const getZLoginToolCatalog = (client: ZLoginClient, enableAutomation = true): Tool[] => {
	const tools: ToolDefinition[] = [
		...loadApiToolCatalog(),
		...(enableAutomation ? createAutomationToolCatalog(new BrowserSessionManager(client)) : [])
	];
	assertUniqueNames(tools);
	return tools.map((definition) => definition.tool);
};
