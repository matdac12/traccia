import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Dev only: with VITE_TRACCIA_DEV_API (and TRACCIA_DEV_TOKEN) set, `/v1/…` goes to that API with the Token added
// here, so the front end works in a plain browser (src/native.ts). The Token never reaches the page.
const devApi = process.env.VITE_TRACCIA_DEV_API;
const devToken = process.env.TRACCIA_DEV_TOKEN;

// Tauri loads the dev server from this exact port (src-tauri/tauri.conf.json, build.devUrl).
export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 3170,
    strictPort: true,
    ...(devApi && {
      proxy: {
        "/v1": {
          target: devApi,
          changeOrigin: true,
          headers: devToken ? { authorization: `Bearer ${devToken}` } : {},
          configure(proxy) {
            // An unreachable API reads as offline, as the Rust side reports it.
            proxy.on("error", (err, _req, res) => {
              if ("writeHead" in res && !res.headersSent) {
                res.writeHead(502, { "x-traccia-dev-proxy": "offline" });
                res.end(err.message);
              }
            });
          },
        },
      },
    }),
  },
  build: { target: "es2022" },
});
