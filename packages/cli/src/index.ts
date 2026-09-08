#!/usr/bin/env node
/** CLI 入口只负责编排参数和输出，Runtime 安装细节位于 runtime.ts。 */
import * as os from "node:os";
import * as process from "node:process";
import { downloadAndInstallRuntime, fetchReleaseManifest, readCurrentRuntime } from "./runtime.js";

const CLI_VERSION = "0.1.0";
const json = process.argv.includes("--json");
const command = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
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
	output({ ok: true, platform: process.platform, arch: process.arch, runtime: current ?? "not-installed" });
}
if (group === "runtime" && action === "status") {
	const current = await readCurrentRuntime();
	output({ status: current ? "installed" : "not-installed", protocolVersion: 1, platform: process.platform, arch: process.arch, current });
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
if (group === "auth" && action === "status") output({ authenticated: false });
output({ error: "unknown_command", command: command.join(" "), host: os.hostname() }, 1);
