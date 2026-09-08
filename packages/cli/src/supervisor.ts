import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as process from "node:process";
import { runtimeRoot, readCurrentRuntime, type InstalledRuntime } from "./runtime.js";

export interface RuntimeEndpoint {
	pid: number;
	version: string;
	port: number;
	token: string;
	healthUrl: string;
	startedAt: string;
}

export interface RuntimeStatus {
	installed: InstalledRuntime | null;
	endpoint: RuntimeEndpoint | null;
	running: boolean;
}

export interface StartRuntimeOptions {
	executable?: string;
	launchArgs?: string[];
	timeoutMs?: number;
	intervalMs?: number;
}

const endpointPath = (): string => path.join(runtimeRoot(), "endpoint.json");

const isLoopback = (hostname: string): boolean => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

const parseEndpoint = (value: unknown): RuntimeEndpoint => {
	if (!value || typeof value !== "object") throw new Error("Runtime endpoint is invalid");
	const endpoint = value as Partial<RuntimeEndpoint>;
	const pid = endpoint.pid;
	const port = endpoint.port;
	const version = endpoint.version;
	const token = endpoint.token;
	if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) throw new Error("Runtime endpoint has an invalid pid");
	if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Runtime endpoint has an invalid port");
	if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error("Runtime endpoint has an invalid version");
	if (!token || token.length < 16 || token.length > 512) throw new Error("Runtime endpoint has an invalid token");
	const healthUrl = new URL(endpoint.healthUrl ?? `http://127.0.0.1:${port}/health`);
	if (healthUrl.protocol !== "http:" || !isLoopback(healthUrl.hostname)) throw new Error("Runtime health URL must use loopback HTTP");
	if (Number(healthUrl.port || 80) !== port) throw new Error("Runtime health URL port does not match endpoint");
	return {
		pid,
		port,
		version,
		token,
		healthUrl: healthUrl.toString(),
		startedAt: endpoint.startedAt ?? new Date(0).toISOString()
	};
};

export const readRuntimeEndpoint = async (): Promise<RuntimeEndpoint | null> => {
	try {
		return parseEndpoint(JSON.parse(await readFile(endpointPath(), "utf8")));
	} catch {
		return null;
	}
};

const processExists = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export const runtimeHealth = async (endpoint: RuntimeEndpoint, timeoutMs = 1500): Promise<boolean> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(endpoint.healthUrl, {
			headers: { "x-zlogin-runtime-token": endpoint.token },
			signal: controller.signal
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
};

const locateExecutable = async (installed: InstalledRuntime): Promise<string> => {
	try {
		const manifest = JSON.parse(await readFile(path.join(installed.path, "manifest.json"), "utf8")) as { entryPoint?: string };
		if (manifest.entryPoint && !path.isAbsolute(manifest.entryPoint)) {
			const candidate = path.resolve(installed.path, manifest.entryPoint);
			if (candidate.startsWith(`${path.resolve(installed.path)}${path.sep}`) && await stat(candidate).then(() => true).catch(() => false)) return candidate;
		}
	} catch {
		// Fall through to conventional packaged names for older manifests.
	}
	const names = process.platform === "win32" ? ["zlogin-runtime.exe", "runtime.exe"] : ["zlogin-runtime", "runtime"];
	for (const name of names) {
		const candidate = path.join(installed.path, name);
		if (await stat(candidate).then(() => true).catch(() => false)) return candidate;
	}
	throw new Error("Installed Runtime executable was not found");
};

const waitForEndpoint = async (expectedVersion: string, timeoutMs: number, intervalMs: number): Promise<RuntimeEndpoint> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const endpoint = await readRuntimeEndpoint();
		if (endpoint?.version === expectedVersion && processExists(endpoint.pid) && await runtimeHealth(endpoint)) {
			await protectEndpointFile();
			return endpoint;
		}
		await new Promise(resolve => setTimeout(resolve, intervalMs));
	}
	throw new Error(`Runtime health check timed out after ${timeoutMs}ms`);
};

export const getRuntimeStatus = async (): Promise<RuntimeStatus> => {
	const installed = await readCurrentRuntime();
	const endpoint = await readRuntimeEndpoint();
	const running = endpoint !== null && processExists(endpoint.pid) && await runtimeHealth(endpoint);
	if (endpoint && !running && installed?.version === endpoint.version) await rm(endpointPath(), { force: true });
	return { installed, endpoint: running ? endpoint : null, running };
};

export const startRuntime = async (options: StartRuntimeOptions = {}): Promise<RuntimeEndpoint> => {
	const existing = await getRuntimeStatus();
	if (existing.running && existing.endpoint) return existing.endpoint;
	if (!existing.installed) throw new Error("Runtime is not installed");
	const executable = options.executable ?? await locateExecutable(existing.installed);
	const endpointFile = endpointPath();
	await rm(endpointFile, { force: true });
	const args = [...(options.launchArgs ?? []), "--endpoint-file", endpointFile];
	const child = spawn(executable, args, {
		cwd: existing.installed.path,
		stdio: "ignore",
		detached: false,
		windowsHide: true,
		env: { ...process.env, ZLOGIN_RUNTIME_VERSION: existing.installed.version, ZLOGIN_RUNTIME_BOOT_ID: randomUUID() }
	});
	child.unref();
	return waitForEndpoint(existing.installed.version, options.timeoutMs ?? 10000, options.intervalMs ?? 100);
};

export const stopRuntime = async (timeoutMs = 5000): Promise<boolean> => {
	const endpoint = await readRuntimeEndpoint();
	if (!endpoint || !processExists(endpoint.pid)) {
		await rm(endpointPath(), { force: true });
		return false;
	}
	const shutdownUrl = new URL(endpoint.healthUrl);
	shutdownUrl.pathname = "/shutdown";
	try {
		await fetch(shutdownUrl, { method: "POST", headers: { "x-zlogin-runtime-token": endpoint.token } });
	} catch {
		// Poll below and leave the process untouched if the endpoint is unavailable.
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processExists(endpoint.pid)) {
			await rm(endpointPath(), { force: true });
			return true;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	try {
		process.kill(endpoint.pid, "SIGTERM");
	} catch {
		// The process may have exited between the last poll and the signal.
	}
	await rm(endpointPath(), { force: true });
	throw new Error("Runtime did not stop before the timeout");
};

export const protectEndpointFile = async (): Promise<void> => {
	try {
		await chmod(endpointPath(), 0o600);
	} catch {
		// Windows ACLs are managed by the Runtime installer and do not use chmod.
	}
};
