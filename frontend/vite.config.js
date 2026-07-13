import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `mode` lets us harden only the production bundle. Dev keeps console output and
 * readable code; the shipped bundle is mangled with console/debugger stripped so
 * the client-side shuffle maths is meaningfully harder to reverse-engineer.
 *
 * NOTE: this is deliberately "raise the bar", not a security boundary — a
 * determined attacker can always read a shipped bundle. The real protections for
 * Three-Shell Monte are server-side (the winning slot never leaves the server
 * before resolve, the swaps are streamed just-in-time, and the resolve is
 * time-gated). Do NOT rely on obfuscation to keep the game honest. For stronger
 * mangling you can add `vite-plugin-javascript-obfuscator`, production-only, so
 * dev stays debuggable.
 */
export default defineConfig(({ mode }) => ({
	plugins: [react()],
	publicDir: "../public",
	// Strip console/debugger from the production build only.
	esbuild:
		mode === "production"
			? { drop: ["console", "debugger"], legalComments: "none" }
			: {},
	server: {
		port: 3000,
		force: true, // always clear the pre-bundle cache on startup
		hmr: {
			protocol: "wss",
			host: "localhost",
			clientPort: 42424,
		},
		watch: {
			usePolling: true, // needed for Docker volume mounts on Mac
			interval: 500,
		},
		proxy: {
			"/api": {
				target: "http://backend:8000",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
		// esbuild (Vite's default) already mangles local identifiers; keeping it
		// explicit documents that the shipped bundle is minified + name-mangled.
		minify: "esbuild",
		chunkSizeWarningLimit: 2000,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return undefined;
					if (id.includes("phaser")) return "vendor-phaser";
					if (
						id.includes("react") ||
						id.includes("react-dom") ||
						id.includes("react-router-dom")
					)
						return "vendor-react";
					return "vendor";
				},
			},
		},
	},
}));
