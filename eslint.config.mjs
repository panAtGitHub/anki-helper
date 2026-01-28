import json from "@eslint/json";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

const obsidianConfigs = obsidianmd.configs.recommendedWithLocalesEn;
const obsidianRecommendedScoped = [...obsidianConfigs].map((config) => {
	if (config.files) return config;
	return { ...config, files: ["**/*.{ts,tsx,js,jsx}"] };
});

const textParser = {
	meta: { name: "text-parser", version: "0.0.0" },
	parseForESLint(text) {
		return {
			ast: {
				type: "Program",
				body: [],
				sourceType: "module",
				range: [0, text.length],
				tokens: [],
				comments: [],
				loc: {
					start: { line: 1, column: 0 },
					end: { line: 1, column: text.length },
				},
			},
		};
	},
};

export default defineConfig([
	{
		files: ["**/*"],
		ignores: ["node_modules/**", "main.js"],
	},
	...obsidianRecommendedScoped,
	{
		files: ["**/*.json"],
		language: "json/json",
		...json.configs.recommended,
	},
	{
		files: ["manifest.json", "versions.json", "data.json"],
		language: "json/json",
		plugins: { ...json.configs.recommended.plugins, obsidianmd },
		rules: {
			...json.configs.recommended.rules,
			"obsidianmd/validate-manifest": "error",
		},
	},
	{
		files: ["LICENSE"],
		languageOptions: { parser: textParser },
		plugins: { obsidianmd },
		rules: {
			"obsidianmd/validate-license": "error",
		},
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
				sourceType: "module",
			},
			globals: {
				...globals.browser,
				...globals.node,
				createFragment: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
]);
