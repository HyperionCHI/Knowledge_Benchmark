import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Isolated UI fixture: no application server, authentication or database writes.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 3013, strictPort: true },
});
