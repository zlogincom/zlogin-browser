import type { ZLoginProfileSelector } from "zlogin-core";
import { listProfiles } from "./openapi.js";
import { requireRuntimeEndpoint, runtimeControlRequest } from "./control.js";
import { getRuntimeStatus } from "./supervisor.js";

type ProfileRecord = Record<string, unknown>;

const asItems = (value: unknown): ProfileRecord[] => {
	if (Array.isArray(value)) return value.filter((item): item is ProfileRecord => !!item && typeof item === "object" && !Array.isArray(item));
	if (value && typeof value === "object") {
		const record = value as ProfileRecord;
		for (const key of ["items", "profiles", "data"] as const) {
			if (key in record) return asItems(record[key]);
		}
	}
	return [];
};

const positiveId = (value: unknown): number | null => {
	const number = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d*$/.test(value.trim()) ? Number(value) : NaN;
	return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const resolveProfileId = async (selector: ZLoginProfileSelector): Promise<number> => {
	const direct = positiveId(selector.profileId);
	if (direct) return direct;
	const requestedCode = typeof selector.profileCode === "string" ? selector.profileCode.trim().toLowerCase() : null;
	const requestedNo = selector.profileNo === undefined ? null : String(selector.profileNo).trim();
	const page = await listProfiles();
	const item = asItems(page.data).find(candidate =>
		(requestedCode !== null && String(candidate.profileCode ?? candidate.code ?? "").trim().toLowerCase() === requestedCode)
		|| (requestedNo !== null && String(candidate.profileNo ?? candidate.no ?? "").trim() === requestedNo)
	);
	const resolved = positiveId(item?.profileId ?? item?.id);
	if (!resolved) throw new Error("Profile selector could not be resolved to a numeric profile ID");
	return resolved;
};

const runtimeAvailable = async (): Promise<boolean> => {
	const status = await getRuntimeStatus();
	return status.running || status.installed !== null;
};

/** 使用本地 Runtime 控制协议操作环境；未安装 Runtime 时返回 null 供旧 Open API 路径兼容。 */
export const startProfileWithRuntime = async (selector: ZLoginProfileSelector): Promise<unknown | null> => {
	if (!(await runtimeAvailable())) return null;
	const profileId = await resolveProfileId(selector);
	await requireRuntimeEndpoint();
	return runtimeControlRequest("/profile/start", { method: "POST", body: JSON.stringify({ profileId }) }, 60000);
};

export const getProfileStatusWithRuntime = async (selector: ZLoginProfileSelector): Promise<unknown | null> => {
	if (!(await runtimeAvailable())) return null;
	const profileId = await resolveProfileId(selector);
	await requireRuntimeEndpoint();
	return runtimeControlRequest(`/profile/${profileId}/status`);
};

export const stopProfileWithRuntime = async (selector: ZLoginProfileSelector): Promise<unknown | null> => {
	if (!(await runtimeAvailable())) return null;
	const profileId = await resolveProfileId(selector);
	await requireRuntimeEndpoint();
	return runtimeControlRequest(`/profile/${profileId}/stop`, { method: "POST", body: "{}" });
};
