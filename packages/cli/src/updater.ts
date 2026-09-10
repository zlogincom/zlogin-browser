import type { ZLoginRuntimeReleaseManifest } from "zlogin-core";
import { prepareRuntimeInstall, type InstalledRuntime } from "./runtime.js";
import { getRuntimeStatus, startRuntime, stopRuntime, type RuntimeEndpoint, type StartRuntimeOptions } from "./supervisor.js";

export interface RuntimeUpdateResult {
	installed: InstalledRuntime;
	endpoint: RuntimeEndpoint;
}

/**
 * An update is committed only after the candidate Runtime passes the real
 * endpoint health contract. A previously running Runtime is restored on any
 * preparation or startup failure.
 */
export const updateRuntime = async (
	manifest: ZLoginRuntimeReleaseManifest,
	startOptions: StartRuntimeOptions = {}
): Promise<RuntimeUpdateResult> => {
	const before = await getRuntimeStatus();
	let transaction: Awaited<ReturnType<typeof prepareRuntimeInstall>> | null = null;
	try {
		if (before.running) await stopRuntime();
		transaction = await prepareRuntimeInstall(manifest);
		const endpoint = await startRuntime(startOptions);
		await transaction.commit();
		return { installed: transaction.installed, endpoint };
	} catch (error) {
		if (transaction) {
			try {
				await stopRuntime(1000);
			} catch {
				// Rollback still restores files and the current pointer.
			}
			await transaction.rollback();
		}
		if (before.running) {
			try {
				await startRuntime(startOptions);
			} catch (restoreError) {
				throw new AggregateError([error, restoreError], "Runtime update failed and the previous Runtime could not be restarted");
			}
		}
		throw error;
	}
};
