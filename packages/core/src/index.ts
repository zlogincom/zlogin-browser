export const ZLOGIN_MCP_SERVER_NAME = "zlogin-mcp";
export const ZLOGIN_MCP_SERVER_VERSION = "0.1.0";

export const ZLOGIN_AGENT_INSTRUCTIONS =
	"Use ZLogin Open API tools only for capabilities supported by the connected local client. Prefer profileCode when known. Read current state before updates and supply If-Match or idempotency keys when requested by the schema. Browser automation tools maintain internal Playwright sessions; call connect-browser first or connect-browser-with-ws after open-browser.";

export interface ZLoginProfileSelector {
	profileId?: string | number;
	profileNo?: string | number;
	profileCode?: string;
}

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
