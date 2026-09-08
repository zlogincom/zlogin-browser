import { spawn } from "node:child_process";
import * as process from "node:process";
import type { ZLoginRuntimeAuthStatus, ZLoginRuntimeDeviceLoginPoll, ZLoginRuntimeDeviceLoginStart } from "zlogin-core";
import { runtimeControlRequest } from "./control.js";

export interface LoginOptions {
	noBrowser?: boolean;
	timeoutMs?: number;
	onStarted?: (login: ZLoginRuntimeDeviceLoginStart) => void;
}

const openSystemBrowser = (url: string): void => {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
		throw new Error("Verification URL is not trusted");
	}
	const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", parsed.toString()] : [parsed.toString()];
	const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
	child.unref();
};

export const getAuthStatus = async (): Promise<ZLoginRuntimeAuthStatus> => runtimeControlRequest("/auth/status");

export const logout = async (): Promise<{ revoked: boolean }> => runtimeControlRequest("/auth/logout", { method: "POST", body: "{}" });

export const login = async (options: LoginOptions = {}): Promise<ZLoginRuntimeAuthStatus> => {
	const started = await runtimeControlRequest<ZLoginRuntimeDeviceLoginStart>("/auth/login/start", { method: "POST", body: "{}" });
	const expiresAt = Date.parse(started.expiresAt);
	if (!started.loginId || !started.userCode || !Number.isFinite(expiresAt) || started.pollIntervalMs < 100) throw new Error("Runtime returned an invalid login challenge");
	options.onStarted?.(started);
	if (!options.noBrowser) openSystemBrowser(started.verificationUrlComplete ?? started.verificationUrl);
	const deadline = Math.min(expiresAt, Date.now() + (options.timeoutMs ?? Math.max(0, expiresAt - Date.now())));
	let interval = started.pollIntervalMs;
	while (Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, interval));
		const poll = await runtimeControlRequest<ZLoginRuntimeDeviceLoginPoll>("/auth/login/poll", {
			method: "POST",
			body: JSON.stringify({ loginId: started.loginId })
		});
		if (poll.status === "authorized" && poll.session?.authenticated) return poll.session;
		if (poll.status === "denied") throw new Error("Device login was denied");
		if (poll.status === "expired") throw new Error("Device login expired");
		if (poll.status === "slow_down") interval = Math.max(interval + 1000, poll.retryAfterMs ?? 0);
		else if (poll.retryAfterMs) interval = Math.max(interval, poll.retryAfterMs);
	}
	throw new Error("Device login timed out");
};
