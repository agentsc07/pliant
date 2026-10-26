import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      // Serve the side-by-side page at /compare.
      name: "compare-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/compare" || req.url?.startsWith("/compare?")) req.url = req.url.replace("/compare", "/compare.html");
          next();
        });
      },
    },
  ],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), compare: resolve(__dirname, "compare.html") } } },
});
