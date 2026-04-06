import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return undefined;
					if (id.includes("@mui") || id.includes("@emotion")) return "mui";
					if (id.includes("@tauri-apps")) return "tauri";
					return undefined;
				},
			},
		},
	},
	clearScreen: false,
	server: {
		port: 31420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 31421,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
}));
