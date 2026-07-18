import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The @factory/composition workspace package is consumed as raw TS/TSX source,
// so let esbuild transpile it (don't pre-bundle) and allow reading it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  optimizeDeps: { exclude: ["@factory/composition"] },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/storage": "http://localhost:4000",
    },
  },
});
