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
  // Keep true third-party npm packages external (they stay in node_modules).
  // Everything under src/ is bundled into the single output file.
  external: [
    "commander",
    "zod",
    "xlsx",
    "pg",
    "next",
    "react",
    "react-dom",
    "recharts",
  ],
  // Suppress "mixed named + default" warnings from the pipeline modules
  silent: true,
});
