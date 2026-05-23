#!/usr/bin/env node
/**
 * Package DSTC8 Schema-Guided Dialogue split files into one uploadable JSON payload.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Parse simple --key value CLI arguments.
 * @param {string[]} argv CLI arguments.
 * @returns {{ source?: string; out?: string; limit?: string; files?: string; split?: string; dialogues?: string }}
 */
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

/**
 * Read and parse one JSON file.
 * @param {string} filePath JSON file path.
 * @returns {Promise<unknown>} Parsed JSON.
 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/**
 * Resolve dialogue files from a source split folder.
 * @param {string} sourceDir SGD split folder.
 * @param {string | undefined} files Comma-separated file list.
 * @param {number} limit Max dialogue files to read.
 * @returns {Promise<string[]>} Dialogue file names.
 */
async function resolveDialogueFiles(sourceDir, files, limit) {
  if (files) {
    return files.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const allFiles = await readdir(sourceDir);
  return allFiles
    .filter((item) => /^dialogues_\d+\.json$/i.test(item))
    .sort()
    .slice(0, limit);
}

/**
 * Collect dialogues from selected files.
 * @param {string} sourceDir SGD split folder.
 * @param {string[]} fileNames Dialogue file names.
 * @returns {Promise<unknown[]>} Dialogue records.
 */
async function collectDialogues(sourceDir, fileNames) {
  const batches = await Promise.all(fileNames.map((fileName) => readJson(path.join(sourceDir, fileName))));
  return batches.flatMap((batch) => (Array.isArray(batch) ? batch : []));
}

/**
 * Filter schema definitions to the services used by selected dialogues.
 * @param {unknown[]} schema Full SGD schema array.
 * @param {unknown[]} dialogues Dialogue records.
 * @returns {unknown[]} Schema records used by selected dialogues.
 */
function filterSchema(schema, dialogues) {
  const usedServices = new Set(
    dialogues.flatMap((dialogue) =>
      dialogue && typeof dialogue === "object" && Array.isArray(dialogue.services) ? dialogue.services : [],
    ),
  );
  return schema.filter((service) =>
    service && typeof service === "object" && usedServices.has(service.service_name),
  );
}

/**
 * Entrypoint for generating an uploadable SGD package.
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args.source ?? "/private/tmp/dstc8-schema-guided-dialogue/train";
  const outputPath = args.out ?? "public/datasets/sgd-package-sample.json";
  const limit = Number(args.limit ?? "1");
  const split = args.split ?? path.basename(sourceDir);
  const fileNames = await resolveDialogueFiles(sourceDir, args.files, Number.isFinite(limit) ? limit : 1);
  const schema = await readJson(path.join(sourceDir, "schema.json"));
  const dialogueLimit = Number(args.dialogues ?? "0");
  const allDialogues = await collectDialogues(sourceDir, fileNames);
  const dialogues = Number.isFinite(dialogueLimit) && dialogueLimit > 0
    ? allDialogues.slice(0, dialogueLimit)
    : allDialogues;
  const payload = {
    source: "dstc8-schema-guided-dialogue",
    split,
    files: fileNames,
    schema: Array.isArray(schema) ? filterSchema(schema, dialogues) : [],
    dialogues,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        outputPath,
        files: fileNames.length,
        dialogues: dialogues.length,
        schemaServices: payload.schema.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
