/**
 * CLI 诊断与自动修复。
 *
 * 诊断只读取 Runtime 暴露的脱敏状态和本机配置，不会输出控制 Token、API Key
 * 或 Runtime 会话凭据。`--repair` 只尝试启动已安装但未运行的 Runtime，避免
 * 在健康进程仍存活时覆盖它。
 */
import { mkdir, statfs, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as process from "node:process";
import { runtimeRoot } from "./runtime.js";
import { getRuntimeStatus, runtimeHealth, startRuntime, type RuntimeEndpoint } from "./supervisor.js";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
	name: string;
	status: DoctorCheckStatus;
	message: string;
	details?: Record<string, unknown>;
}

export interface DoctorReport {
	ok: boolean;
	repaired: boolean;
	generatedAt: string;
	checks: DoctorCheck[];
	runtime: {
		installed: boolean;
		version?: string;
		running: boolean;
		pid?: number;
		port?: number;
	};
}

interface RuntimeControlResult {
	status: number;
	body: unknown;
}

const check = (name: string, status: DoctorCheckStatus, message: string, details?: Record<string, unknown>): DoctorCheck => ({ name, status, message, ...(details ? { details } : {}) });

const endpointRequest = async (endpoint: RuntimeEndpoint, pathname: string, timeoutMs = 3000): Promise<RuntimeControlResult> => {
	const url = new URL(endpoint.healthUrl);
	url.pathname = pathname;
	url.search = "";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json", "x-zlogin-runtime-token": endpoint.token },
			signal: controller.signal
		});
		const body = await response.json().catch(() => null);
		return { status: response.status, body };
	} finally {
		clearTimeout(timer);
	}
};

const checkOpenApiConfig = (): DoctorCheck => {
	const rawUrl = process.env.ZLOGIN_OPENAPI_URL ?? "http://127.0.0.1:50025";
	try {
		const url = new URL(rawUrl);
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.protocol !== "http:" || !loopback) return check("openapi-config", "fail", "Open API URL 必须使用回环 HTTP");
		return process.env.ZLOGIN_OPENAPI_KEY?.trim()
			? check("openapi-config", "pass", "Open API 回环地址和 API Key 已配置", { url: url.origin })
			: check("openapi-config", "warn", "未配置 ZLOGIN_OPENAPI_KEY，profile 命令将不可用", { url: url.origin });
	} catch {
		return check("openapi-config", "fail", "Open API URL 格式无效");
	}
};

const checkDisk = async (): Promise<DoctorCheck> => {
	try {
		const info = await statfs(runtimeRoot());
		const freeBytes = Number(info.bavail) * Number(info.bsize);
		const freeGiB = Math.round((freeBytes / 1024 ** 3) * 100) / 100;
		if (!Number.isFinite(freeBytes) || freeBytes < 100 * 1024 ** 2) return check("disk-space", "fail", "Runtime 所在磁盘可用空间不足", { freeBytes, freeGiB });
		if (freeBytes < 512 * 1024 ** 2) return check("disk-space", "warn", "Runtime 所在磁盘可用空间偏低", { freeBytes, freeGiB });
		return check("disk-space", "pass", "Runtime 所在磁盘可用空间正常", { freeBytes, freeGiB });
	} catch {
		return check("disk-space", "warn", "无法读取 Runtime 所在磁盘空间");
	}
};

const checkRuntimeEndpoint = async (endpoint: RuntimeEndpoint | null): Promise<DoctorCheck> => {
	if (!endpoint) return check("runtime-health", "fail", "Runtime 未运行或健康检查未通过");
	if (!(await runtimeHealth(endpoint))) return check("runtime-health", "fail", "Runtime 进程存在但健康检查未通过");
	return check("runtime-health", "pass", "Runtime 健康检查通过", { version: endpoint.version, pid: endpoint.pid, port: endpoint.port });
};

const inspectRuntimeServices = async (endpoint: RuntimeEndpoint, checks: DoctorCheck[]): Promise<void> => {
	try {
		const diagnostics = await endpointRequest(endpoint, "/diagnostics");
		if (diagnostics.status === 200 && diagnostics.body && typeof diagnostics.body === "object") {
			const body = diagnostics.body as { capabilities?: unknown; uptimeSeconds?: unknown };
			checks.push(check("runtime-diagnostics", "pass", "Runtime 诊断接口可用", {
				uptimeSeconds: typeof body.uptimeSeconds === "number" ? body.uptimeSeconds : undefined,
				capabilities: body.capabilities
			}));
		} else if (diagnostics.status === 404) {
			checks.push(check("runtime-diagnostics", "warn", "Runtime 版本未提供诊断接口"));
		} else {
			checks.push(check("runtime-diagnostics", "warn", "Runtime 诊断接口返回异常", { status: diagnostics.status }));
		}
	} catch {
		checks.push(check("runtime-diagnostics", "warn", "无法访问 Runtime 诊断接口"));
	}
	try {
		const auth = await endpointRequest(endpoint, "/auth/status");
		if (auth.status === 200 && auth.body && typeof auth.body === "object") {
			const authenticated = (auth.body as { authenticated?: unknown }).authenticated === true;
			checks.push(check("runtime-auth", authenticated ? "pass" : "warn", authenticated ? "Runtime 已登录" : "Runtime 尚未登录"));
		} else if (auth.status === 503) {
			checks.push(check("runtime-auth", "warn", "Runtime 未配置云端认证"));
		} else {
			checks.push(check("runtime-auth", "warn", "无法读取 Runtime 登录状态", { status: auth.status }));
		}
	} catch {
		checks.push(check("runtime-auth", "warn", "无法读取 Runtime 登录状态"));
	}
	try {
		const kernels = await endpointRequest(endpoint, "/kernel/list");
		if (kernels.status === 200 && kernels.body && typeof kernels.body === "object") {
			const items = (kernels.body as { items?: unknown }).items;
			checks.push(check("runtime-kernel", "pass", "Runtime 内核目录可访问", { installedCount: Array.isArray(items) ? items.length : 0 }));
		} else if (kernels.status === 503) {
			checks.push(check("runtime-kernel", "warn", "Runtime 未配置内核服务"));
		} else {
			checks.push(check("runtime-kernel", "warn", "无法读取 Runtime 内核目录", { status: kernels.status }));
		}
	} catch {
		checks.push(check("runtime-kernel", "warn", "无法读取 Runtime 内核目录"));
	}
};

const writeBundle = async (bundlePath: string, report: DoctorReport): Promise<void> => {
	const resolved = path.resolve(bundlePath);
	await mkdir(path.dirname(resolved), { recursive: true });
	await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
};

export const runDoctor = async (options: { repair?: boolean; bundlePath?: string } = {}): Promise<DoctorReport> => {
	const checks: DoctorCheck[] = [];
	const supportedPlatform = ["win32", "darwin", "linux"].includes(process.platform);
	checks.push(supportedPlatform ? check("platform", "pass", "当前平台受支持", { platform: process.platform, arch: process.arch }) : check("platform", "fail", "当前平台不受支持", { platform: process.platform, arch: process.arch }));
	let status = await getRuntimeStatus();
	let repaired = false;
	if (status.installed) {
		checks.push(check("runtime-installation", "pass", "Runtime 已安装", { version: status.installed.version }));
	} else {
		checks.push(check("runtime-installation", "fail", "Runtime 尚未安装"));
	}
	if (options.repair && status.installed && !status.running) {
		try {
			await startRuntime();
			repaired = true;
			status = await getRuntimeStatus();
			checks.push(check("runtime-repair", status.running ? "pass" : "fail", status.running ? "已启动并修复 Runtime" : "Runtime 修复启动后仍未通过健康检查"));
		} catch (error) {
			checks.push(check("runtime-repair", "fail", "Runtime 自动修复失败", { reason: error instanceof Error ? error.message : "unknown" }));
		}
	}
	checks.push(await checkRuntimeEndpoint(status.endpoint));
	if (status.endpoint && status.running) await inspectRuntimeServices(status.endpoint, checks);
	else checks.push(check("runtime-services", "skip", "Runtime 未运行，跳过认证和内核服务检查"));
	checks.push(checkOpenApiConfig());
	checks.push(await checkDisk());
	const report: DoctorReport = {
		ok: checks.every(item => item.status !== "fail"),
		repaired,
		generatedAt: new Date().toISOString(),
		checks,
		runtime: {
			installed: status.installed !== null,
			...(status.installed ? { version: status.installed.version } : {}),
			running: status.running,
			...(status.endpoint ? { pid: status.endpoint.pid, port: status.endpoint.port } : {})
		}
	};
	if (options.bundlePath) await writeBundle(options.bundlePath, report);
	return report;
};
