import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base:
    process.env.GITHUB_PAGES === "true"
      ? "/amazon-ppc-bid-audit-dashboard/"
      : "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    // Bumped from default 500 KB — the main bundle still won't hit this even
    // after splitting, but keeps the warning quiet in CI.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Group heavy libs into their own chunks so the main app bundle
          // shrinks. Loaded only when their entry point is imported.
          if (
            /[\\/]node_modules[\\/](recharts|d3-|victory-vendor|react-smooth)/.test(
              id,
            )
          ) {
            return "vendor-charts";
          }
          if (/[\\/]node_modules[\\/]xlsx/.test(id)) return "vendor-files";
          if (/[\\/]node_modules[\\/]@sentry/.test(id)) return "vendor-sentry";
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router-dom|react-is)[\\/]/.test(
              id,
            )
          ) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },
});
