/**
 * @fileoverview Zero-dependency ANSI terminal output helpers for the Zeval CLI.
 */

const ESC = "\x1b";
const R = `${ESC}[0m`;

/** ANSI colour/style helpers. */
export const c = {
  green:   (s: string) => `${ESC}[32m${s}${R}`,
  red:     (s: string) => `${ESC}[31m${s}${R}`,
  yellow:  (s: string) => `${ESC}[33m${s}${R}`,
  cyan:    (s: string) => `${ESC}[36m${s}${R}`,
  blue:    (s: string) => `${ESC}[34m${s}${R}`,
  magenta: (s: string) => `${ESC}[35m${s}${R}`,
  bold:    (s: string) => `${ESC}[1m${s}${R}`,
  dim:     (s: string) => `${ESC}[2m${s}${R}`,
};

/** ✓ success */
export function ok(msg: string): void {
  console.log(`${c.green("✓")} ${msg}`);
}

/** ⚠ warning */
export function warn(msg: string): void {
  console.warn(`${c.yellow("⚠")} ${msg}`);
}

/** ✗ error */
export function err(msg: string): void {
  console.error(`${c.red("✗")} ${msg}`);
}

/** Section header */
export function header(title: string): void {
  console.log(`\n${c.bold(c.cyan(title))}`);
}

/** Single key: value row */
export function kv(key: string, value: string | number): void {
  console.log(`  ${c.dim(`${key}:`)} ${value}`);
}

/** Multi-row label/value table */
export function table(rows: Array<[string, string | number]>, padKeyTo = 30): void {
  for (const [key, value] of rows) {
    if (key === "") {
      console.log();
      continue;
    }
    const isRule = key.startsWith("─");
    if (isRule) {
      console.log(`  ${c.dim(key)}`);
      continue;
    }
    console.log(`  ${c.dim(key.padEnd(padKeyTo))} ${value}`);
  }
}

// ── Spinner ───────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  succeed(msg: string): void;
  fail(msg: string): void;
  update(label: string): void;
}

/**
 * Create a simple terminal spinner.
 * The spinner is backed by setInterval so callers must always call
 * .succeed() or .fail() to clean it up.
 */
export function createSpinner(initialLabel: string): Spinner {
  let label = initialLabel;
  let frame = 0;
  const isTTY = Boolean(process.stdout.isTTY);

  if (!isTTY) {
    // Non-interactive: just print the label once
    process.stdout.write(`  … ${label}\n`);
    return {
      succeed(msg) { console.log(`  ✓ ${msg}`); },
      fail(msg)    { console.error(`  ✗ ${msg}`); },
      update(l)    { label = l; },
    };
  }

  const interval = setInterval(() => {
    process.stdout.write(`\r${c.cyan(FRAMES[frame++ % FRAMES.length]!)} ${label}  `);
  }, 80);

  return {
    succeed(msg: string) {
      clearInterval(interval);
      process.stdout.write(`\r${c.green("✓")} ${msg}                    \n`);
    },
    fail(msg: string) {
      clearInterval(interval);
      process.stdout.write(`\r${c.red("✗")} ${msg}                    \n`);
    },
    update(l: string) {
      label = l;
    },
  };
}
