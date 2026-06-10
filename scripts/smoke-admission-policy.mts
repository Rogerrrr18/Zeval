/**
 * @fileoverview Smoke test for admission policy learn/store/score pipeline.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import admissionFeatureExtractor from "../src/benchmark/admission-feature-extractor.ts";
import admissionPolicyHoldout from "../src/benchmark/admission-policy-holdout.ts";
import admissionPolicyLearner from "../src/benchmark/admission-policy-learner.ts";
import admissionPolicyStore from "../src/benchmark/admission-policy-store.ts";
import type { AdmissionLabelRow } from "../src/benchmark/admission-policy-types.ts";
import admissionScorer from "../src/benchmark/admission-scorer.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../src/benchmark/__fixtures__");
const labels = JSON.parse(
  readFileSync(join(fixtureDir, "human-labels-mock-100.json"), "utf8"),
) as AdmissionLabelRow[];

const projectId = "smoke-default";
const policy = admissionPolicyLearner.learnAdmissionPolicy(labels, {
  projectId,
  policyId: "smoke-policy-v1",
});
await admissionPolicyStore.saveAdmissionPolicy(policy);

const loaded = await admissionPolicyStore.readAdmissionPolicy(projectId);
if (!loaded) {
  throw new Error("Failed to read persisted admission policy.");
}

const holdout = admissionPolicyHoldout.evaluatePolicyHoldoutAgreement(labels, { seed: 42 });
const sampleFeature = {
  sessionId: labels[0].sessionId,
  caseId: labels[0].caseId,
  channel: labels[0].channel,
  metricKey: labels[0].metricKey,
  autoScore: labels[0].autoScore,
  confidence: labels[0].confidence,
  qualityScore: labels[0].qualityScore,
  qualityPercentile: labels[0].qualityScore,
  judgeVariance: labels[0].judgeVariance,
};
const scored = admissionScorer.scoreAdmission(sampleFeature, loaded.channels[labels[0].channel]);
const features = admissionFeatureExtractor.extractAdmissionFeatures([]);

console.log(JSON.stringify({
  projectId,
  labelCount: loaded.labelCount,
  channels: Object.keys(loaded.channels),
  holdoutAgreement: round2(holdout.agreementRate),
  sampleDecision: scored.decision,
  extractedFeatureCount: features.length,
}, null, 2));

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
