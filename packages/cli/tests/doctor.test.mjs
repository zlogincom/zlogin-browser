import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDoctor } from "../dist/doctor.js";

test("doctor reports missing Runtime and writes a sanitized support bundle", async t => {
	const home = await mkdtemp(join(tmpdir(), "zlogin-cli-doctor-"));
	const bundle = join(home, "diagnostics", "report.json");
	const previousHome = process.env.ZLOGIN_RUNTIME_HOME;
	const previousKey = process.env.ZLOGIN_OPENAPI_KEY;
	process.env.ZLOGIN_RUNTIME_HOME = home;
	delete process.env.ZLOGIN_OPENAPI_KEY;
	t.after(async () => {
		if (previousHome === undefined) delete process.env.ZLOGIN_RUNTIME_HOME;
		else process.env.ZLOGIN_RUNTIME_HOME = previousHome;
		if (previousKey === undefined) delete process.env.ZLOGIN_OPENAPI_KEY;
		else process.env.ZLOGIN_OPENAPI_KEY = previousKey;
		await rm(home, { recursive: true, force: true });
	});

	const report = await runDoctor({ bundlePath: bundle });
	assert.equal(report.ok, false);
	assert.equal(report.repaired, false);
	assert.equal(report.runtime.installed, false);
	const installation = report.checks.find(item => item.name === "runtime-installation");
	assert.equal(installation.status, "fail");
	assert.equal(installation.details.errorCode, "runtime_not_installed");
	assert.equal(installation.details.action, "zlogin runtime update");
	const health = report.checks.find(item => item.name === "runtime-health");
	assert.equal(health.details.errorCode, "runtime_unavailable");
	const bundleBody = await readFile(bundle, "utf8");
	assert.deepEqual(JSON.parse(bundleBody), report);
	assert.doesNotMatch(bundleBody, /secret-control|runtime-session|access_token|refresh_token/i);
});
