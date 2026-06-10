/**

 * @fileoverview Generate policy-golden-v1.json regression snapshot.

 */



import { readFileSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import { learnAdmissionPolicy } from "../src/benchmark/admission-policy-learner.ts";



const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../src/benchmark/__fixtures__");

const labels = JSON.parse(readFileSync(join(fixtureDir, "human-labels-mock-100.json"), "utf8"));

const policy = learnAdmissionPolicy(labels, {

  projectId: "golden",

  policyId: "policy-golden-v1",

  generatedAt: "2026-01-01T00:00:00.000Z",

});



writeFileSync(

  join(fixtureDir, "policy-golden-v1.json"),

  `${JSON.stringify({ channels: policy.channels, labelCount: policy.labelCount }, null, 2)}\n`,

  "utf8",

);



console.log("Wrote policy-golden-v1.json");

