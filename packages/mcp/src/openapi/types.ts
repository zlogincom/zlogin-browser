import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HttpMethod } from "../types.js";

export type JsonObject = Record<string, unknown>;

export interface OpenApiParameterBinding {
	inputName: string;
	wireName: string;
	location: "path" | "query" | "header";
}

export interface ApiToolDefinition {
	kind: "api";
	routeId: string;
	method: HttpMethod;
	path: string;
	auth: boolean;
	tool: Tool;
	parameterBindings: OpenApiParameterBinding[];
	bodyMode: "none" | "flat" | "wrapped";
	bodyInputNames: string[];
	bodyRequired: boolean;
}

export interface OpenApiOperation extends JsonObject {
	operationId?: string;
	summary?: string;
	parameters?: OpenApiParameter[];
	requestBody?: {
		required?: boolean;
		content?: Record<string, { schema?: JsonObject }>;
	};
	security?: Array<Record<string, unknown>>;
}

export interface OpenApiParameter extends JsonObject {
	name?: string;
	in?: "path" | "query" | "header";
	required?: boolean;
	schema?: JsonObject;
	$ref?: string;
}

export interface OpenApiDocument extends JsonObject {
	paths: Record<string, Record<string, unknown>>;
	components?: {
		schemas?: Record<string, JsonObject>;
		parameters?: Record<string, OpenApiParameter>;
	};
}
