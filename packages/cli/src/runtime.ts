import { createHash, verify as verifySignature } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ZLoginRuntimeReleaseManifest } from "zlogin-core";
import { ZLoginCliError } from "./errors.js";

const CURRENT_CLI_VERSION = "0.1.0";
const CURRENT_RUNTIME_PROTOCOL_VERSION = 1;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const RUNTIME_ARTIFACT_TYPES = new Set(["zip", "tar", "tar.gz"]);

const parseVersion = (value: unknown, field: string): [number, number, number] => {
	if (typeof value !== "string") throw new Error(`Runtime manifest has an invalid ${field}`);
	const match = SEMVER_PATTERN.exec(value.trim());
	if (!match) throw new Error(`Runtime manifest has an invalid ${field}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (left: [number, number, number], right: [number, number, number]): number => {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
};

const execFileAsync = promisify(execFile);

export interface InstalledRuntime {
	version: string;
	path: string;
}

export interface RuntimeInstallTransaction {
	installed: InstalledRuntime;
	previous: InstalledRuntime | null;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export const runtimeRoot = (): string =>
	process.env.ZLOGIN_RUNTIME_HOME ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "ZLogin", "Runtime");

const versionPath = (version: string): string => path.join(runtimeRoot(), version);
const currentPath = (): string => path.join(runtimeRoot(), "current.json");

const isTrustedHttpUrl = (value: string): boolean => {
	const url = new URL(value);
	return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
};

const fetchTrusted = async (initialUrl: string): Promise<Response> => {
	let requestUrl = initialUrl;
	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		const response = await fetch(requestUrl, { redirect: "manual" });
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		const location = response.headers.get("location");
		if (!location) throw new Error("Runtime request redirect is missing its location");
		if (redirectCount === 5) throw new Error("Runtime request has too many redirects");
		requestUrl = new URL(location, requestUrl).toString();
		if (!isTrustedHttpUrl(requestUrl)) throw new Error("Runtime request redirect is not trusted");
	}
	throw new Error("Runtime request failed");
};

const runtimeReleaseRequestError = async (response: Response): Promise<ZLoginCliError> => {
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		// A proxy or an older API may return an empty/non-JSON error body.
	}
	const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
	const upstreamCode = typeof record?.title === "string" && record.title.trim() ? record.title.trim() : undefined;
	const detail = typeof record?.detail === "string" && record.detail.trim() ? record.detail.trim() : undefined;
	const message = detail ?? upstreamCode ?? `Runtime release manifest request failed (${response.status})`;
	const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
	return new ZLoginCliError(
		"runtime_request_failed",
		message,
		retryable ? 6 : 4,
		retryable,
		{
			status: response.status,
			...(upstreamCode ? { upstreamCode } : {})
		}
	);
};

export const readCurrentRuntime = async (): Promise<InstalledRuntime | null> => {
	try {
		const value = JSON.parse(await readFile(currentPath(), "utf8")) as { version?: string };
		if (!value.version || !/^[A-Za-z0-9._-]+$/.test(value.version)) return null;
		const installedPath = versionPath(value.version);
		await stat(installedPath);
		return { version: value.version, path: installedPath };
	} catch {
		return null;
	}
};

export const validateReleaseManifest = (manifest: ZLoginRuntimeReleaseManifest): void => {
	if (!manifest || manifest.status !== "active") {
		const code = manifest?.status === "revoked" ? "runtime_release_revoked" : "runtime_release_inactive";
		throw new ZLoginCliError(code, "Runtime release is not active", 7, false);
	}
	if (typeof manifest.releaseId !== "string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(manifest.releaseId)) throw new Error("Runtime manifest has an invalid release id");
	if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new ZLoginCliError("runtime_platform_mismatch", "Runtime release does not match this platform", 5, false);
	if (manifest.protocolVersion !== CURRENT_RUNTIME_PROTOCOL_VERSION) throw new ZLoginCliError("runtime_protocol_unsupported", "Runtime release protocol version is unsupported", 5, false);
	if (manifest.entryPoint !== undefined) {
		if (typeof manifest.entryPoint !== "string" || !manifest.entryPoint.trim() || path.posix.isAbsolute(manifest.entryPoint) || path.win32.isAbsolute(manifest.entryPoint)) {
			throw new Error("Runtime manifest has an invalid entry point");
		}
		const normalizedEntryPoint = manifest.entryPoint.replaceAll("\\", "/");
		if (normalizedEntryPoint.split("/").some(segment => segment === "." || segment === ".." || segment === "")) {
			throw new Error("Runtime manifest has an unsafe entry point");
		}
	}
	if (manifest.artifactType !== undefined && !RUNTIME_ARTIFACT_TYPES.has(manifest.artifactType)) {
		throw new Error("Runtime manifest has an unsupported artifact type");
	}
	const minimumCliVersion = parseVersion(manifest.minCliVersion, "minimum CLI version");
	if (compareVersions(minimumCliVersion, parseVersion(CURRENT_CLI_VERSION, "CLI version")) > 0) {
		throw new ZLoginCliError("runtime_cli_outdated", "Runtime release requires a newer CLI version", 5, false);
	}
	if (!isTrustedHttpUrl(manifest.downloadUrl)) {
		throw new Error("Runtime download URL is not trusted");
	}
	if (!/^[a-fA-F0-9]{64}$/.test(manifest.sha256)) throw new Error("Runtime manifest has an invalid SHA-256");
	if (!Number.isSafeInteger(manifest.fileSize) || manifest.fileSize <= 0) throw new Error("Runtime manifest has an invalid file size");
	if (!manifest.signature || !manifest.signatureKeyId) throw new Error("Runtime manifest is missing its signature metadata");
};

const extractArchive = async (archivePath: string, destination: string): Promise<void> => {
	let listing: string;
	let verboseListing: string;
	try {
		({ stdout: listing } = await execFileAsync("tar", ["-tf", archivePath], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
		({ stdout: verboseListing } = await execFileAsync("tar", ["-tvf", archivePath], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
	} catch {
		throw new Error("Runtime archive cannot be inspected; tar is required");
	}
	for (const entry of listing.split(/\r?\n/).filter(Boolean)) {
		const normalized = entry.replaceAll("\\", "/");
		if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
			throw new Error("Runtime archive contains an unsafe path");
		}
	}
	if (verboseListing.split(/\r?\n/).some(entry => /^[lh][rwx-]{9}\s/.test(entry))) {
		throw new Error("Runtime archive contains a link");
	}
	try {
		await execFileAsync("tar", ["-xf", archivePath, "-C", destination], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
	} catch {
		throw new Error("Runtime archive extraction failed");
	}
};

const validateExtractedFiles = async (directory: string, manifest: ZLoginRuntimeReleaseManifest): Promise<void> => {
	const pending = [directory];
	while (pending.length > 0) {
		const current = pending.pop()!;
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const entryPath = path.join(current, entry.name);
			const info = await lstat(entryPath);
			if (info.isSymbolicLink()) throw new Error("Runtime archive contains a symbolic link");
			if (info.isDirectory()) pending.push(entryPath);
		}
	}
	if (manifest.entryPoint) {
		const entryPoint = path.resolve(directory, manifest.entryPoint);
		const info = await stat(entryPoint).catch(() => null);
		if (!info?.isFile()) throw new Error("Runtime archive entry point is missing");
	}
};

const resolveTrustedPublicKey = (manifest: ZLoginRuntimeReleaseManifest): string => {
	const keyring = process.env.ZLOGIN_RUNTIME_TRUSTED_KEYS;
	if (keyring?.trim()) {
		let entries: unknown;
		try {
			entries = JSON.parse(keyring);
		} catch {
			throw new Error("Runtime signature keyring is invalid");
		}
		if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
			throw new Error("Runtime signature keyring is invalid");
		}
		const value = (entries as Record<string, unknown>)[manifest.signatureKeyId];
		if (typeof value !== "string" || !value.trim()) {
			throw new Error("Runtime signature key is not trusted");
		}
		return value;
	}

	const publicKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	if (!publicKey) throw new Error("Runtime signature public key is not configured");
	const expectedKeyId = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID;
	if (expectedKeyId && expectedKeyId !== manifest.signatureKeyId) throw new Error("Runtime signature key is not trusted");
	return publicKey;
};

const verifyArtifact = async (archivePath: string, manifest: ZLoginRuntimeReleaseManifest): Promise<void> => {
	const data = await readFile(archivePath);
	if (data.byteLength !== manifest.fileSize) throw new Error("Runtime download size does not match manifest");
	const hash = createHash("sha256").update(data).digest("hex");
	if (hash.toLowerCase() !== manifest.sha256.toLowerCase()) throw new Error("Runtime SHA-256 verification failed");
	const publicKey = resolveTrustedPublicKey(manifest);
	const signature = Buffer.from(manifest.signature, "base64");
	if (!verifySignature(null, data, publicKey, signature)) throw new Error("Runtime signature verification failed");
};

export const fetchReleaseManifest = async (endpoint: string, channel = "stable"): Promise<ZLoginRuntimeReleaseManifest> => {
	const url = new URL(endpoint);
	if (!isTrustedHttpUrl(url.toString())) {
		throw new Error("Runtime release endpoint is not trusted");
	}
	url.searchParams.set("channel", channel);
	url.searchParams.set("platform", process.platform);
	url.searchParams.set("arch", process.arch);
	url.searchParams.set("protocol_version", String(CURRENT_RUNTIME_PROTOCOL_VERSION));
	const response = await fetchTrusted(url.toString());
	if (!response.ok) throw await runtimeReleaseRequestError(response);
	const manifest = (await response.json()) as ZLoginRuntimeReleaseManifest;
	validateReleaseManifest(manifest);
	return manifest;
};

const downloadArtifact = async (
	manifest: ZLoginRuntimeReleaseManifest,
	archivePath: string
): Promise<void> => {
	const response = await fetchTrusted(manifest.downloadUrl);
	if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status})`);
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null && Number(declaredLength) !== manifest.fileSize) {
		throw new Error("Runtime download size does not match manifest");
	}
	let received = 0;
	const enforceSize = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			received += chunk.byteLength;
			callback(received > manifest.fileSize ? new Error("Runtime download exceeds manifest size") : null, chunk);
		}
	});
	await pipeline(response.body, enforceSize, createWriteStream(archivePath));
	if (received !== manifest.fileSize) throw new Error("Runtime download size does not match manifest");
};

const writeCurrentVersion = async (version: string): Promise<void> => {
	const pointer = `${currentPath()}.tmp-${process.pid}`;
	await writeFile(pointer, JSON.stringify({ version }), "utf8");
	await rename(pointer, currentPath());
};

export const prepareRuntimeInstall = async (manifest: ZLoginRuntimeReleaseManifest): Promise<RuntimeInstallTransaction> => {
	validateReleaseManifest(manifest);
	const root = runtimeRoot();
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "zlogin-runtime-"));
	const archivePath = path.join(tempRoot, "runtime.download");
	const lockPath = path.join(root, "install.lock");
	let lockAcquired = false;
	let targetBackedUp = false;
	let candidateActivated = false;
	let pointerUpdated = false;
	let finalized = false;
	let previous: InstalledRuntime | null = null;
	const target = versionPath(manifest.runtimeVersion);
	const staging = `${target}.install-${process.pid}`;
	const backup = `${target}.previous-${process.pid}`;
	const releaseLock = async (): Promise<void> => {
		if (lockAcquired) {
			lockAcquired = false;
			await rm(lockPath, { force: true });
		}
	};
	const restore = async (): Promise<void> => {
		if (candidateActivated) await rm(target, { recursive: true, force: true });
		if (targetBackedUp) await rename(backup, target);
		if (pointerUpdated) {
			if (previous) await writeCurrentVersion(previous.version);
			else await rm(currentPath(), { force: true });
		}
	};
	try {
		await mkdir(root, { recursive: true });
		await writeFile(lockPath, `${process.pid}\n`, { flag: "wx" });
		lockAcquired = true;
		await downloadArtifact(manifest, archivePath);
		await verifyArtifact(archivePath, manifest);
		await rm(staging, { recursive: true, force: true });
		await rm(backup, { recursive: true, force: true });
		await mkdir(staging, { recursive: true });
		await extractArchive(archivePath, staging);
		await validateExtractedFiles(staging, manifest);
		await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
		previous = await readCurrentRuntime();
		if (await stat(target).then(() => true).catch(() => false)) {
			await rename(target, backup);
			targetBackedUp = true;
		}
		await rename(staging, target);
		candidateActivated = true;
		await writeCurrentVersion(manifest.runtimeVersion);
		pointerUpdated = true;
		await rm(tempRoot, { recursive: true, force: true });
		const installed = { version: manifest.runtimeVersion, path: target };
		return {
			installed,
			previous,
			commit: async () => {
				if (finalized) return;
				finalized = true;
				await rm(backup, { recursive: true, force: true }).catch(() => undefined);
				await releaseLock();
			},
			rollback: async () => {
				if (finalized) return;
				finalized = true;
				try {
					await restore();
				} finally {
					await releaseLock();
				}
			}
		};
	} catch (error) {
		try {
			await restore();
		} finally {
			await rm(staging, { recursive: true, force: true });
			await rm(tempRoot, { recursive: true, force: true });
			await releaseLock();
		}
		throw error;
	}
};

export const downloadAndInstallRuntime = async (manifest: ZLoginRuntimeReleaseManifest): Promise<InstalledRuntime> => {
	const transaction = await prepareRuntimeInstall(manifest);
	await transaction.commit();
	return transaction.installed;
};
