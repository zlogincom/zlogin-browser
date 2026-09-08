#!/usr/bin/env node
/** ZLogin CLI：负责 Runtime 生命周期入口，业务语义通过本地 Runtime/Open API 转发。 */
import process from "node:process";
import os from "node:os";

const args = process.argv.slice(2);
const json = args.includes("--json");
const command = args.filter(arg => !arg.startsWith("--"));
const output = (value: unknown, code = 0): never => {
	if (json) console.log(JSON.stringify(value));
	else if (typeof value === "string") console.log(value);
	else console.log(JSON.stringify(value, null, 2));
	process.exit(code);
};

const [group = "version", action] = command;
if (group === "version") output({ cliVersion: "0.1.0", protocolVersion: 1 });
if (group === "doctor") output({ ok: true, platform: process.platform, arch: process.arch, runtime: "not-installed" });
if (group === "runtime" && action === "status") output({ status: "not-running", protocolVersion: 1, platform: process.platform, arch: process.arch });
if (group === "runtime" && action === "update") output({ status: "not-configured", message: "Runtime release manifest endpoint is not configured" }, 2);
if (group === "auth" && action === "status") output({ authenticated: false });
output({ error: "unknown_command", command: command.join(" "), host: os.hostname() }, 1);
