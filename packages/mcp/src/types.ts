export type QueryValue = string | number | boolean | null | undefined;

export interface ZLoginMcpConfig {
	apiKey: string;
	baseUrl: string;
	timeoutMs: number;
	enableAutomation: boolean;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ZLoginRateLimit {
	limit: number | null;
	remaining: number | null;
	reset: number | null;
	retryAfter: number | null;
}

export interface ZLoginResult<TData> {
	data: TData;
	status: number;
	requestId: string;
	etag: string | null;
	rateLimit: ZLoginRateLimit;
}

export interface ZLoginProfileSelector {
	profileId?: string | number;
	profileNo?: string | number;
	profileCode?: string;
}

export interface ZLoginProfileListInput {
	pageNumber?: number;
	pageSize?: number;
	profileId?: string | number;
	profileNo?: string | number;
	profileCode?: string;
	keyword?: string;
	name?: string;
	groupCode?: string;
	tagCode?: string;
	isOpened?: boolean;
	sortBy?: "profileNo" | "profileId" | "customNo" | "name" | "createdAt" | "updatedAt" | "lastOpenedAt";
	sortDirection?: "asc" | "desc";
}

export interface ZLoginLaunchOverrides {
	startupUrls?: string[];
	windowMode?: "inherit" | "top-left" | "last-position" | "minimized" | "maximized";
}

export interface ZLoginRequestOptions {
	auth?: boolean;
	path?: Readonly<Record<string, string | number>>;
	query?: Readonly<Record<string, QueryValue>>;
	body?: unknown;
	idempotencyKey?: string;
	ifMatch?: string;
	timeoutMs?: number;
}
