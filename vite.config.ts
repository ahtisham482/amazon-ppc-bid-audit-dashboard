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
    // Bump chunk-size warning threshold so the CI log isn't loud about the
    // single vendor chunk. xlsx (heavy) is already dynamic-imported in
    // lib/analysis.ts, so it's pulled into its own chunk on demand.
    // Privacy / Terms / Changelog are React.lazy() routes — also lazy.
    // We intentionally do NOT use manualChunks: it caused a circular vendor
    // dependency on GH Pages where React loaded after a module that needed
    // React.createContext (Phase 3 deploy blocker).
    chunkSizeWarningLimit: 1100,
  },
});
