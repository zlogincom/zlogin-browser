/**
 * CLI 对 Runtime/API 错误的稳定归一化。
 *
 * Runtime 和云端版本可能独立升级，CLI 不直接把后端文案当作协议；
 * 这里保留原始消息，同时把常见业务失败映射为可供脚本判断的错误码。
 */
import { ZLOGIN_RUNTIME_ERROR_CODES, type ZLoginRuntimeErrorCode } from "zlogin-core";

type ErrorRecord = Record<string, unknown>;

export interface CliErrorDetails {
	status?: number;
	requestId?: string | null;
	upstreamCode?: string;
}

export class ZLoginCliError extends Error {
	constructor(
		readonly code: ZLoginRuntimeErrorCode,
		message: string,
		readonly exitCode = 4,
		readonly retryable = false,
		readonly details: CliErrorDetails = {},
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = "ZLoginCliError";
	}
}

const asRecord = (value: unknown): ErrorRecord | null => {
	if (!value || typeof value !== "object") return null;
	return value as ErrorRecord;
};

const readString = (record: ErrorRecord | null, key: string): string | undefined => {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const readNumber = (record: ErrorRecord | null, key: string): number | undefined => {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const sourceDetails = (error: unknown): { code?: string; status?: number; requestId?: string | null } => {
	const record = asRecord(error);
	return {
		code: readString(record, "code")?.toLowerCase(),
		status: readNumber(record, "status"),
		requestId: readString(record, "requestId") ?? null
	};
};

const mapCode = (rawCode: string | undefined, message: string, status?: number): { code: ZLoginRuntimeErrorCode; exitCode: number; retryable: boolean } => {
	const value = `${rawCode ?? ""} ${message}`.toLowerCase();
	if (value.includes("quota") || value.includes("limit_exceeded")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.QuotaExceeded, exitCode: 8, retryable: false };
	}
	if (value.includes("revoked") || value.includes("revoke")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.ReleaseRevoked, exitCode: 7, retryable: false };
	}
	if (value.includes("not active") || value.includes("paused") || value.includes("inactive")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.ReleaseInactive, exitCode: 7, retryable: false };
	}
	if (value.includes("not installed")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.NotInstalled, exitCode: 5, retryable: false };
	}
	if (value.includes("protocol version") || value.includes("protocol_unsupported")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.ProtocolUnsupported, exitCode: 5, retryable: false };
	}
	if (value.includes("platform") && (value.includes("match") || value.includes("support"))) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.PlatformMismatch, exitCode: 5, retryable: false };
	}
	if (value.includes("newer cli") || value.includes("cli version")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.CliOutdated, exitCode: 5, retryable: false };
	}
	if (status === 401 || status === 403 || value.includes("authentication") || value.includes("unauthorized") || value.includes("auth required")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.AuthRequired, exitCode: 3, retryable: false };
	}
	if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || value.includes("timed out") || value.includes("unavailable") || value.includes("crashed")) {
		return { code: ZLOGIN_RUNTIME_ERROR_CODES.Unavailable, exitCode: 6, retryable: true };
	}
	return { code: ZLOGIN_RUNTIME_ERROR_CODES.RequestFailed, exitCode: 4, retryable: false };
};

export const normalizeRuntimeError = (error: unknown, fallbackMessage = "Runtime request failed"): ZLoginCliError => {
	if (error instanceof ZLoginCliError) return error;
	const record = asRecord(error);
	const source = error instanceof Error ? error.message : readString(record, "message") ?? fallbackMessage;
	const details = sourceDetails(error);
	const mapped = mapCode(details.code, source, details.status);
	return new ZLoginCliError(mapped.code, source, mapped.exitCode, mapped.retryable, {
		...(details.status === undefined ? {} : { status: details.status }),
		...(details.requestId === null ? {} : { requestId: details.requestId }),
		...(details.code ? { upstreamCode: details.code } : {})
	}, error instanceof Error ? { cause: error } : undefined);
};

export const isRuntimeCliError = (error: unknown): error is ZLoginCliError => error instanceof ZLoginCliError;
