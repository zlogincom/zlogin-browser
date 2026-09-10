import { createHash, verify as verifySignature } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ZLoginRuntimeReleaseManifest } from "zlogin-core";

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

export const runtimeRoot = (): string =>
	process.env.ZLOGIN_RUNTIME_HOME ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "ZLogin", "Runtime");

const versionPath = (version: string): string => path.join(runtimeRoot(), version);
const currentPath = (): string => path.join(runtimeRoot(), "current.json");

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
	if (!manifest || manifest.status !== "active") throw new Error("Runtime release is not active");
	if (typeof manifest.releaseId !== "string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(manifest.releaseId)) throw new Error("Runtime manifest has an invalid release id");
	if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("Runtime release does not match this platform");
	if (manifest.protocolVersion !== CURRENT_RUNTIME_PROTOCOL_VERSION) throw new Error("Runtime release protocol version is unsupported");
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
		throw new Error("Runtime release requires a newer CLI version");
	}
	const download = new URL(manifest.downloadUrl);
	if (download.protocol !== "https:" && !(download.protocol === "http:" && ["localhost", "127.0.0.1"].includes(download.hostname))) {
		throw new Error("Runtime download URL is not trusted");
	}
	if (!/^[a-fA-F0-9]{64}$/.test(manifest.sha256)) throw new Error("Runtime manifest has an invalid SHA-256");
	if (!Number.isSafeInteger(manifest.fileSize) || manifest.fileSize <= 0) throw new Error("Runtime manifest has an invalid file size");
	if (!manifest.signature || !manifest.signatureKeyId) throw new Error("Runtime manifest is missing its signature metadata");
};

const extractArchive = async (archivePath: string, destination: string): Promise<void> => {
	let listing: string;
	try {
		({ stdout: listing } = await execFileAsync("tar", ["-tf", archivePath], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
	} catch {
		throw new Error("Runtime archive cannot be inspected; tar is required");
	}
	for (const entry of listing.split(/\r?\n/).filter(Boolean)) {
		const normalized = entry.replaceAll("\\", "/");
		if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
			throw new Error("Runtime archive contains an unsafe path");
		}
	}
	try {
		await execFileAsync("tar", ["-xf", archivePath, "-C", destination], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
	} catch {
		throw new Error("Runtime archive extraction failed");
	}
};

const verifyArtifact = async (archivePath: string, manifest: ZLoginRuntimeReleaseManifest): Promise<void> => {
	const data = await readFile(archivePath);
	if (data.byteLength !== manifest.fileSize) throw new Error("Runtime download size does not match manifest");
	const hash = createHash("sha256").update(data).digest("hex");
	if (hash.toLowerCase() !== manifest.sha256.toLowerCase()) throw new Error("Runtime SHA-256 verification failed");
	const publicKey = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY;
	if (!publicKey) throw new Error("Runtime signature public key is not configured");
	const expectedKeyId = process.env.ZLOGIN_RUNTIME_PUBLIC_KEY_ID;
	if (expectedKeyId && expectedKeyId !== manifest.signatureKeyId) throw new Error("Runtime signature key is not trusted");
	const signature = Buffer.from(manifest.signature, "base64");
	if (!verifySignature(null, data, publicKey, signature)) throw new Error("Runtime signature verification failed");
};

export const fetchReleaseManifest = async (endpoint: string, channel = "stable"): Promise<ZLoginRuntimeReleaseManifest> => {
	const url = new URL(endpoint);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
		throw new Error("Runtime release endpoint is not trusted");
	}
	url.searchParams.set("channel", channel);
	url.searchParams.set("platform", process.platform);
	url.searchParams.set("arch", process.arch);
	url.searchParams.set("protocol_version", String(CURRENT_RUNTIME_PROTOCOL_VERSION));
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Runtime release manifest request failed (${response.status})`);
	const manifest = (await response.json()) as ZLoginRuntimeReleaseManifest;
	validateReleaseManifest(manifest);
	return manifest;
};

export const downloadAndInstallRuntime = async (manifest: ZLoginRuntimeReleaseManifest): Promise<InstalledRuntime> => {
	validateReleaseManifest(manifest);
	const root = runtimeRoot();
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "zlogin-runtime-"));
	const archivePath = path.join(tempRoot, "runtime.download");
	const lockPath = path.join(root, "install.lock");
	let lockAcquired = false;
	try {
		await mkdir(root, { recursive: true });
		await writeFile(lockPath, `${process.pid}\n`, { flag: "wx" });
		lockAcquired = true;
		const response = await fetch(manifest.downloadUrl);
		if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status})`);
		await pipeline(response.body, createWriteStream(archivePath));
		await verifyArtifact(archivePath, manifest);
		const target = versionPath(manifest.runtimeVersion);
		const staging = `${target}.install-${process.pid}`;
		const backup = `${target}.previous-${process.pid}`;
		await rm(staging, { recursive: true, force: true });
		await rm(backup, { recursive: true, force: true });
		await mkdir(staging, { recursive: true });
		await extractArchive(archivePath, staging);
		await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
		const previous = await readCurrentRuntime();
		if (await stat(target).then(() => true).catch(() => false)) await rename(target, backup);
		try {
			await rename(staging, target);
			const pointer = `${currentPath()}.tmp-${process.pid}`;
			await writeFile(pointer, JSON.stringify({ version: manifest.runtimeVersion }), "utf8");
			await rename(pointer, currentPath());
			await rm(backup, { recursive: true, force: true });
		} catch (error) {
			await rm(target, { recursive: true, force: true });
			if (await stat(backup).then(() => true).catch(() => false)) await rename(backup, target);
			if (previous) await writeFile(currentPath(), JSON.stringify({ version: previous.version }), "utf8");
			throw error;
		}
		return { version: manifest.runtimeVersion, path: target };
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
		if (lockAcquired) await rm(lockPath, { force: true });
	}
};
