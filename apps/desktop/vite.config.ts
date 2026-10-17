import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Tauri loads the dev server from this exact port (src-tauri/tauri.conf.json, build.devUrl).
export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  clearScreen: false,
  server: { host: "127.0.0.1", port: 3170, strictPort: true },
  build: { target: "es2022" },
});
