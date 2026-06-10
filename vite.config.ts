import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// poe.ninja does not send CORS headers, so the browser can't call it
// directly. The dev server proxies /ninja/* to https://poe.ninja/*.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ninja": {
        target: "https://poe.ninja",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ninja/, ""),
      },
    },
  },
});
