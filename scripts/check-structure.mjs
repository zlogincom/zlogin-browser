import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const requiredFiles = [
	"README.md",
	"SECURITY.md",
	"CONTRIBUTING.md",
	"package.json",
	"pnpm-workspace.yaml",
	"docs/ARCHITECTURE.md",
	"docs/PUBLIC-RELEASE-CHECKLIST.md",
	"packages/core/package.json",
	"packages/cli/package.json",
	"packages/mcp/package.json",
	"skills/zlogin-browser/SKILL.md",
	"skills/zlogin-browser/agents/openai.yaml",
	"skills/zlogin-browser/references/tool-intent-map.md",
	"skills/zlogin-browser/references/workflows.md"
];

for (const relativePath of requiredFiles) {
	try {
		await access(resolve(root, relativePath));
	} catch {
		throw new Error(`Missing required scaffold file: ${relativePath}`);
	}
}

const skill = await readFile(resolve(root, "skills/zlogin-browser/SKILL.md"), "utf8");
if (!skill.startsWith("---\n") || skill.includes("[TODO")) {
	throw new Error("The zlogin-browser skill must have valid frontmatter and no unfinished TODO placeholders");
}

console.log(`Public repository scaffold is valid (${requiredFiles.length} required files).`);
