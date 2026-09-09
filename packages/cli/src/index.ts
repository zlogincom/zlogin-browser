#!/usr/bin/env node
/** CLI 入口只负责编排参数和输出，Runtime 安装细节位于独立模块。 */
import * as os from "node:os";
import * as process from "node:process";
import { getAuthStatus, login, logout } from "./auth.js";
import { getProfileStatus, listProfiles, OpenApiRequestError, startProfile, stopProfile } from "./openapi.js";
import { ensureKernel, getKernelDownloadStatus, listKernels } from "./kernel.js";
import { downloadAndInstallRuntime, fetchReleaseManifest, readCurrentRuntime } from "./runtime.js";
import { getRuntimeStatus, startRuntime, stopRuntime } from "./supervisor.js";
import { getProfileStatusWithRuntime, startProfileWithRuntime, stopProfileWithRuntime } from "./runtimeProfile.js";

const CLI_VERSION = "0.1.0";
const args = process.argv.slice(2);
const json = args.includes("--json");
const optionValue = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};
const valueOptions = new Set(["--timeout", "--browser-version", "--task-id"]);
const command: string[] = [];
for (let index = 0; index < args.length; index += 1) {
	if (valueOptions.has(args[index])) {
		index += 1;
		continue;
	}
	if (!args[index].startsWith("--")) command.push(args[index]);
}

const output = (value: unknown, code = 0): number => {
	if (json) console.log(JSON.stringify(value));
	else if (typeof value === "string") console.log(value);
	else console.log(JSON.stringify(value, null, 2));
	return code;
};
const errorOutput = (code: string, message: string, exitCode = 2): number => output({ error: code, message }, exitCode);

const handleOpenApiError = (error: unknown): number => {
	if (error instanceof OpenApiRequestError) {
		return output({ error: error.code, message: error.message, status: error.status, requestId: error.requestId }, 4);
	}
	return errorOutput("openapi_request_failed", error instanceof Error ? error.message : "Open API request failed", 4);
};

const run = async (): Promise<number> => {
	const [group = "version", action] = command;
	if (group === "version") return output({ cliVersion: CLI_VERSION, protocolVersion: 1 });
	if (group === "doctor") {
		const current = await readCurrentRuntime();
		const runtime = await getRuntimeStatus();
		return output({ ok: true, platform: process.platform, arch: process.arch, runtime: runtime.running ? runtime.endpoint : current ?? "not-installed" });
	}
	if (group === "runtime" && action === "status") {
		const runtime = await getRuntimeStatus();
		return output({ status: runtime.running ? "running" : runtime.installed ? "installed" : "not-installed", protocolVersion: 1, platform: process.platform, arch: process.arch, current: runtime.installed, endpoint: runtime.endpoint });
	}
	if (group === "runtime" && action === "start") {
		try {
			return output({ status: "running", endpoint: await startRuntime() });
		} catch (error) {
			return errorOutput("runtime_start_failed", error instanceof Error ? error.message : "Runtime start failed");
		}
	}
	if (group === "runtime" && action === "stop") {
		try {
			return output({ status: "stopped", wasRunning: await stopRuntime() });
		} catch (error) {
			return errorOutput("runtime_stop_failed", error instanceof Error ? error.message : "Runtime stop failed");
		}
	}
	if (group === "runtime" && action === "update") {
		try {
			const endpoint = process.env.ZLOGIN_RUNTIME_RELEASES_URL;
			if (!endpoint) throw new Error("Runtime release manifest endpoint is not configured");
			const installed = await downloadAndInstallRuntime(await fetchReleaseManifest(endpoint, process.env.ZLOGIN_RUNTIME_CHANNEL ?? "stable"));
			return output({ status: "installed", ...installed });
		} catch (error) {
			return errorOutput("runtime_update_failed", error instanceof Error ? error.message : "Runtime update failed");
		}
	}
	if (group === "login") {
		try {
			const timeoutValue = optionValue("--timeout");
			const timeoutMs = timeoutValue === undefined ? undefined : Number(timeoutValue) * 1000;
			if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("--timeout must be a positive number of seconds");
			const session = await login({
				noBrowser: args.includes("--no-browser"),
				timeoutMs,
				onStarted: challenge => {
					if (!json) console.log(`Open ${challenge.verificationUrl}\nEnter code: ${challenge.userCode}`);
				}
			});
			return output({ status: "authenticated", session });
		} catch (error) {
			return errorOutput("authentication_failed", error instanceof Error ? error.message : "Authentication failed", 3);
		}
	}
	if (group === "logout") {
		try {
			return output({ status: "logged-out", ...(await logout()) });
		} catch (error) {
			return errorOutput("logout_failed", error instanceof Error ? error.message : "Logout failed", 3);
		}
	}
	if (group === "auth" && action === "status") {
		try {
			return output(await getAuthStatus());
		} catch (error) {
			return errorOutput("authentication_status_failed", error instanceof Error ? error.message : "Authentication status failed", 3);
		}
	}
	if (group === "profile") {
		try {
			if (action === "list") return output(await listProfiles());
			const profileCode = command[2];
			if (!profileCode) throw new Error(`profile ${action ?? "command"} requires a profile code`);
			const selector = { profileCode };
			if (action === "start") return output((await startProfileWithRuntime(selector)) ?? await startProfile(selector));
			if (action === "status") return output((await getProfileStatusWithRuntime(selector)) ?? await getProfileStatus(selector));
			if (action === "stop") return output((await stopProfileWithRuntime(selector)) ?? await stopProfile(selector));
			throw new Error(`Unknown profile command: ${action ?? ""}`);
		} catch (error) {
			return handleOpenApiError(error);
		}
	}
	if (group === "kernel") {
		try {
			if (action === "list") return output(await listKernels());
			if (action === "ensure") {
				const browserVersion = optionValue("--browser-version");
				if (!browserVersion) throw new Error("kernel ensure requires --browser-version");
				return output(await ensureKernel(browserVersion));
			}
			if (action === "download" && command[2] === "status") {
				const taskId = optionValue("--task-id");
				if (!taskId) throw new Error("kernel download status requires --task-id");
				return output(await getKernelDownloadStatus(taskId));
			}
			throw new Error(`Unknown kernel command: ${command.slice(1).join(" ")}`);
		} catch (error) {
			return errorOutput("kernel_command_failed", error instanceof Error ? error.message : "Kernel command failed", 5);
		}
	}
	return output({ error: "unknown_command", command: command.join(" "), host: os.hostname() }, 1);
};

globalThis.process.exitCode = await run();
