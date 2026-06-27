import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hmrHost = process.env.VITE_HMR_HOST;
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT;
const hmrProtocol = process.env.VITE_HMR_PROTOCOL;

export default defineConfig({
	plugins: [react()],
	publicDir: "../public",
	server: {
		port: 3000,
		force: true, // always clear the pre-bundle cache on startup
		...(hmrHost || hmrClientPort || hmrProtocol
			? {
					hmr: {
						...(hmrProtocol ? { protocol: hmrProtocol } : {}),
						...(hmrHost ? { host: hmrHost } : {}),
						...(hmrClientPort
							? { clientPort: Number(hmrClientPort) }
							: {}),
					},
				}
			: {}),
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
