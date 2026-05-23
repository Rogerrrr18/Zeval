/**
 * @fileoverview Stratified random sample batch builder over stored dataset cases.
 */

import { randomBytes } from "node:crypto";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";

/**
 * Parameters for building one stratified sample batch.
 */
export type BuildStratifiedSampleBatchParams = {
  store: DatasetStore;
  requestedGoodcaseCount: number;
  requestedBadcaseCount: number;
  /** 可选种子；相同池子 + 相同种子 → 相同抽样顺序（在案例集合不变时）。 */
  seed?: string;
  strategy?: string;
  targetVersion?: string;
};

/**
 * Build and optionally persist a goodcase/badcase stratified random batch.
 * Within each stratum, dedupes by `normalizedTranscriptHash` before taking the first N after shuffle.
 * @param params Batch parameters including store and requested counts.
 * @param options.persist When true (default), calls `store.saveSampleBatch`.
 * @returns Built record plus warnings when requested counts cannot be met.
 */
export async function buildStratifiedSampleBatch(
  params: BuildStratifiedSampleBatchParams,
  options: { persist?: boolean } = {},
): Promise<{ record: SampleBatchRecord; warnings: string[] }> {
  const persist = options.persist ?? true;
  const warnings: string[] = [];
  const seedBase = params.seed ?? `ephemeral_${Date.now()}`;
  const strategy = params.strategy ?? "stratified_random_v1";

  const goodPool = await params.store.listCases("goodcase");
  const badPool = await params.store.listCases("badcase");

  const pickedGood = pickStratumUniqueHash(goodPool, params.requestedGoodcaseCount, `${seedBase}:goodcase`);
  const pickedBad = pickStratumUniqueHash(badPool, params.requestedBadcaseCount, `${seedBase}:badcase`);

  if (pickedGood.length < params.requestedGoodcaseCount) {
    warnings.push(
      `goodcase 请求 ${params.requestedGoodcaseCount} 条，实际仅可取 ${pickedGood.length} 条（池子 ${goodPool.length} 条，可能因哈希去重后不足）。`,
    );
  }
  if (pickedBad.length < params.requestedBadcaseCount) {
    warnings.push(
      `badcase 请求 ${params.requestedBadcaseCount} 条，实际仅可取 ${pickedBad.length} 条（池子 ${badPool.length} 条，可能因哈希去重后不足）。`,
    );
  }

  const sampleBatchId = `sample_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const record: SampleBatchRecord = {
    sampleBatchId,
    caseIds: [...pickedGood.map((item) => item.caseId), ...pickedBad.map((item) => item.caseId)],
    requestedGoodcaseCount: params.requestedGoodcaseCount,
    requestedBadcaseCount: params.requestedBadcaseCount,
    strategy,
    targetVersion: params.targetVersion,
    createdAt: now,
    actualGoodcaseCount: pickedGood.length,
    actualBadcaseCount: pickedBad.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  if (persist) {
    await params.store.saveSampleBatch(record);
  }

  return { record, warnings };
}

/**
 * Deterministic 32-bit seed from string (FNV-1a style mix).
 * @param input Seed string.
 * @returns Unsigned 32-bit seed.
 */
export function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG factory.
 * @param seed Seed.
 * @returns Function returning [0, 1) floats.
 */
function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-place Fisher–Yates shuffle using provided RNG.
 * @param items Mutable array.
 * @param rng Random in [0,1).
 */
function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(rng() * (index + 1));
    const tmp = items[index];
    items[index] = items[pick]!;
    items[pick] = tmp!;
  }
}

/**
 * Pick up to `want` cases from one pool with hash-level dedupe after seeded shuffle.
 * @param pool All cases in stratum.
 * @param want Requested count.
 * @param seedFragment Seed segment for this stratum.
 * @returns Selected cases (order = post-shuffle walk order).
 */
function pickStratumUniqueHash(pool: DatasetCaseRecord[], want: number, seedFragment: string): DatasetCaseRecord[] {
  if (want <= 0 || pool.length === 0) {
    return [];
  }
  const rng = createMulberry32(hashStringToSeed(seedFragment));
  const working = [...pool];
  shuffleInPlace(working, rng);
  const out: DatasetCaseRecord[] = [];
  const seenHash = new Set<string>();
  for (const item of working) {
    if (seenHash.has(item.normalizedTranscriptHash)) {
      continue;
    }
    seenHash.add(item.normalizedTranscriptHash);
    out.push(item);
    if (out.length >= want) {
      break;
    }
  }
  return out;
}
