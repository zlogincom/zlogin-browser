#!/usr/bin/env node
/** CLI 入口只负责编排参数和输出，Runtime 安装细节位于 runtime.ts。 */
import * as os from "node:os";
import * as process from "node:process";
import { downloadAndInstallRuntime, fetchReleaseManifest, readCurrentRuntime } from "./runtime.js";
import { getRuntimeStatus, startRuntime, stopRuntime } from "./supervisor.js";
import { getAuthStatus, login, logout } from "./auth.js";

const CLI_VERSION = "0.1.0";
const args = process.argv.slice(2);
const json = args.includes("--json");
const optionValue = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};
const valueOptions = new Set(["--timeout"]);
const command: string[] = [];
for (let index = 0; index < args.length; index += 1) {
	if (valueOptions.has(args[index])) { index += 1; continue; }
	if (!args[index].startsWith("--")) command.push(args[index]);
}
const output = (value: unknown, code = 0): void => {
	if (json) console.log(JSON.stringify(value));
	else if (typeof value === "string") console.log(value);
	else console.log(JSON.stringify(value, null, 2));
	process.exit(code);
};
const errorOutput = (code: string, message: string, exitCode = 2): void => output({ error: code, message }, exitCode);

const [group = "version", action] = command;
if (group === "version") output({ cliVersion: CLI_VERSION, protocolVersion: 1 });
if (group === "doctor") {
	const current = await readCurrentRuntime();
	const runtime = await getRuntimeStatus();
	output({ ok: true, platform: process.platform, arch: process.arch, runtime: runtime.running ? runtime.endpoint : current ?? "not-installed" });
}
if (group === "runtime" && action === "status") {
	const runtime = await getRuntimeStatus();
	output({ status: runtime.running ? "running" : runtime.installed ? "installed" : "not-installed", protocolVersion: 1, platform: process.platform, arch: process.arch, current: runtime.installed, endpoint: runtime.endpoint });
}
if (group === "runtime" && action === "start") {
	try {
		output({ status: "running", endpoint: await startRuntime() });
	} catch (error) {
		errorOutput("runtime_start_failed", error instanceof Error ? error.message : "Runtime start failed");
	}
}
if (group === "runtime" && action === "stop") {
	try {
		output({ status: "stopped", wasRunning: await stopRuntime() });
	} catch (error) {
		errorOutput("runtime_stop_failed", error instanceof Error ? error.message : "Runtime stop failed");
	}
}
if (group === "runtime" && action === "update") {
	try {
		const endpoint = process.env.ZLOGIN_RUNTIME_RELEASES_URL;
		if (!endpoint) throw new Error("Runtime release manifest endpoint is not configured");
		const installed = await downloadAndInstallRuntime(await fetchReleaseManifest(endpoint, process.env.ZLOGIN_RUNTIME_CHANNEL ?? "stable"));
		output({ status: "installed", ...installed });
	} catch (error) {
		errorOutput("runtime_update_failed", error instanceof Error ? error.message : "Runtime update failed");
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
		output({ status: "authenticated", session });
	} catch (error) {
		errorOutput("authentication_failed", error instanceof Error ? error.message : "Authentication failed", 3);
	}
}
if (group === "logout") {
	try {
		output({ status: "logged-out", ...(await logout()) });
	} catch (error) {
		errorOutput("logout_failed", error instanceof Error ? error.message : "Logout failed", 3);
	}
}
if (group === "auth" && action === "status") {
	try {
		output(await getAuthStatus());
	} catch (error) {
		errorOutput("authentication_status_failed", error instanceof Error ? error.message : "Authentication status failed", 3);
	}
}
output({ error: "unknown_command", command: command.join(" "), host: os.hostname() }, 1);
