import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: "./" keeps every asset URL relative, so the built site works from any
// subpath (GitHub Pages project sites, Cloudflare Pages previews, file://).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        /* Split by MODULE ID, not by package name.
           The object form names entry modules, and for React that entry is the
           two-line CommonJS shim (`react/index.js` → `cjs/react.production.min.js`).
           Rollup put the shim in the named chunk and left the actual runtime
           unclaimed, so it followed its other importer — recharts — into the
           charts bundle, and `react.js` shipped as a literally empty 1-byte
           file. The split silently did nothing: React was neither separate nor
           cacheable across deploys, and every chart-only change busted it.
           Matching the id catches a package's whole subtree, shims and all. */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-)/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
        },
      },
    },
  },
  test: {
    // Components are smoke-tested through react-dom/server, which needs no DOM.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
