/**
 * @fileoverview tsup build config for the Zeval CLI.
 *
 * Bundles src/cli/index.ts → dist/zeval.cjs (CommonJS, Node 18+).
 * All src/ code is inlined; only third-party runtime deps stay external.
 *
 * Build:  npm run build:cli
 * Output: dist/zeval.cjs  (the executable pointed to by package.json "bin")
 */

import { defineConfig } from "tsup";
import { resolve } from "path";

export default defineConfig({
  entry: {
    zeval: "src/cli/index.ts",
  },
  format: ["cjs"],
  outDir: "dist",
  platform: "node",
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: false,
  // Inject the node shebang so the compiled file is directly executable
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Resolve @/ path aliases to src/
  esbuildOptions(options) {
    options.alias = {
      "@": resolve(__dirname, "src"),
    };
  },
  // Bundle all third-party deps except pg (native addon).
  // commander, zod, xlsx are pure JS — safe to inline.
  // next/react/recharts are never imported by CLI code (they're web-only).
  noExternal: [/^(?!pg$|pg-native$|@vercel|next|react|recharts).*/],
  external: ["pg", "pg-native"],
  // Suppress "mixed named + default" warnings from the pipeline modules
  silent: true,
});
