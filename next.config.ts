import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: "50mb",
  },
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingExcludes: {
    "/*": [
      ".next/**",
      ".zeval-db/**",
      "artifacts/**",
      "dist/**",
      "eval-runs/**",
      "node_modules/**",
      "workspaces/**",
    ],
  },
};

export default nextConfig;
