import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
	{
		files: ["./src/**/*.{js,mjs,cjs}"],
		plugins: { js },
		extends: ["js/recommended"]
	},
	{
		files: ["src/**/*.{js,mjs,cjs}"],
		languageOptions: {
			globals: {
				...globals.browser,
				require: "readonly",
				module: "readonly",
				__dirname: "readonly",
				console: "readonly",
				fetch: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				process: "readonly",
				uxp: "readonly",
				entrypoints: "readonly",
				app: "readonly",
				photoshop: "readonly",
				localStorage: "readonly"
			}
		},
		rules: {
			"no-unused-vars": "warn",
			"no-empty": "off"
		}
	},
	{
		files: ["./server/*.js", "./licence-webpack-plugin/*.js", "./*.config.js"],
		plugins: { js },
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: globals.node
		},
		rules: {
			...js.configs.recommended.rules
		}
	}
]);
