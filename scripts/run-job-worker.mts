import * as jobHandlers from "../src/jobs/handlers.ts";
import * as queue from "../src/queue/index.ts";

const jobHandlersApi = resolveInteropModule(jobHandlers);
const queueApi = resolveInteropModule(queue);

void main().catch((error) => {
  console.error("[jobs:worker] failed", error);
  process.exitCode = 1;
});

/**
 * Run the local Zeval job worker once or in a polling loop.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const workspaceId = getFlagValue(args, "--workspace") ?? process.env.ZEVAL_WORKSPACE_ID ?? "default";
  const concurrency = Number(getFlagValue(args, "--concurrency") ?? process.env.ZEVAL_QUEUE_CONCURRENCY ?? 1);
  const intervalMs = Number(getFlagValue(args, "--interval-ms") ?? process.env.ZEVAL_QUEUE_INTERVAL_MS ?? 2000);

  do {
    const results = await queueApi.runLocalJobBatch(workspaceId, jobHandlersApi.ZEVAL_QUEUE_HANDLERS, concurrency);
    const handled = results.filter((item) => item.job !== null).length;
    console.info(`[jobs:worker] workspace=${workspaceId} handled=${handled}`);
    if (once) {
      break;
    }
    await delay(intervalMs);
  } while (true);
}

/**
 * Read one optional CLI flag value.
 *
 * @param args Raw CLI args.
 * @param flag Flag name.
 * @returns The next token when present.
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

/**
 * Wait for a fixed interval between worker ticks.
 *
 * @param ms Milliseconds to wait.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(250, ms));
  });
}

/**
 * Normalize tsx loader interop so scripts can consume either named exports
 * or a CJS-style default wrapper without branching everywhere.
 *
 * @param module Imported module namespace.
 * @returns Stable callable module surface.
 */
function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
