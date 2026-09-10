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

export type ZLoginRuntimePlatform = "win32" | "darwin" | "linux";
export type ZLoginRuntimeChannel = "stable" | "beta" | "canary";

/** Runtime 发布清单。downloadUrl 只能来自受信任 API，CLI 不接受命令行覆盖。 */
export interface ZLoginRuntimeReleaseManifest {
	releaseId: string;
	runtimeVersion: string;
	protocolVersion: number;
	platform: ZLoginRuntimePlatform;
	arch: string;
	channel: ZLoginRuntimeChannel;
	minApiVersion: string;
	minCliVersion: string;
	downloadUrl: string;
	fileSize: number;
	sha256: string;
	signature: string;
	signatureKeyId: string;
	publishedAt: string;
	status: "draft" | "testing" | "active" | "paused" | "revoked";
}

export const ZLOGIN_RUNTIME_PROTOCOL_VERSION = 1;

export interface ZLoginRuntimeIdentitySummary {
	userId: string;
	displayName: string;
	teamId?: string;
	teamName?: string;
}

export interface ZLoginRuntimeAuthStatus {
	authenticated: boolean;
	identity?: ZLoginRuntimeIdentitySummary;
	expiresAt?: string;
}

/** loginId 是 Runtime 本地会话标识，云端 device code 不会暴露给 CLI。 */
export interface ZLoginRuntimeDeviceLoginStart {
	loginId: string;
	userCode: string;
	verificationUrl: string;
	verificationUrlComplete?: string;
	expiresAt: string;
	pollIntervalMs: number;
}

export interface ZLoginRuntimeDeviceLoginPoll {
	status: "pending" | "slow_down" | "authorized" | "expired" | "denied";
	retryAfterMs?: number;
	session?: ZLoginRuntimeAuthStatus;
}
