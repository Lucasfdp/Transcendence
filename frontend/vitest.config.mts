/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration — kept separate from vite.config.mjs so the development server
 * proxy/HMR settings don't leak into the test environment.
 *
 * Coverage is emitted as lcov into ./coverage/lcov.info so SonarCloud can
 * consume it alongside the backend report.
 */
export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		css: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			reportsDirectory: "./coverage",
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/test/**",
				"src/**/*.d.ts",
				"src/main.tsx",
			],
		},
	},
});
