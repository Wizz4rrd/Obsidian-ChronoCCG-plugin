import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// Build output, Node scripts and tests are not plugin code.
	globalIgnores(["node_modules", "main.js", ".test-build", "esbuild.config.mjs", "scripts", "tests"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
]);
