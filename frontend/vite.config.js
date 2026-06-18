import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	publicDir: "../public",
	server: {
		port: 3000,
		force: true, // always clear the pre-bundle cache on startup
		hmr: {
			protocol: "wss",
			host: "localhost",
			clientPort: 443,
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
	},
});
