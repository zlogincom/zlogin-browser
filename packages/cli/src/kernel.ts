import { runtimeControlRequest } from "./control.js";

export interface RuntimeKernelSummary {
	browserVersion: string;
	buildVersion: string;
	installed: boolean;
	inUse: boolean;
}

export interface RuntimeKernelEnsureResult {
	status: "installed" | "downloading" | "ready";
	browserVersion: string;
	taskId?: string;
}

export const listKernels = (): Promise<{ items: RuntimeKernelSummary[] }> => runtimeControlRequest("/kernel/list");

export const ensureKernel = (browserVersion: string): Promise<RuntimeKernelEnsureResult> => {
	if (!/^[A-Za-z0-9._-]+$/.test(browserVersion)) throw new Error("Browser version is invalid");
	return runtimeControlRequest("/kernel/ensure", { method: "POST", body: JSON.stringify({ browserVersion }) }, 60000);
};

export const getKernelDownloadStatus = (taskId: string): Promise<unknown> => {
	if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("Kernel download task id is invalid");
	return runtimeControlRequest(`/kernel/download/status/${encodeURIComponent(taskId)}`);
};
