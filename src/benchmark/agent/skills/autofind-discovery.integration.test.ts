/**
 * @fileoverview Live AutoFind discovery integration tests against real public datasets.
 *
 * Set AUTOFIND_LIVE_TEST=0 to skip network-dependent cases in offline CI.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAutoFindAgent } from "./autofind-agent.ts";
import { createDefaultAutoFindDiscoveryDeps } from "./autofind-discovery.ts";
import {
  isFictionalDatasetRef,
  isTrustedDatasetUrl,
  validateNormalizedCsv,
} from "./autofind-validation.ts";

const liveEnabled = process.env.AUTOFIND_LIVE_TEST !== "0";

describe("runAutoFindAgent live", { skip: !liveEnabled }, () => {
  it(
    "discovers real companion dataset and normalizes 10 positive + 10 negative sessions",
    { timeout: 120_000 },
    async () => {
      const result = await runAutoFindAgent(
        {
          searchProfile: "情绪陪伴 心理咨询 共情 CPsyCoun",
          datasetProfile: "companion",
          positiveCount: 10,
          negativeCount: 10,
          sessionPrefix: "companion_",
        },
        createDefaultAutoFindDiscoveryDeps(),
      );

      assert.equal(isFictionalDatasetRef(result.selectedCandidate.id), false);
      assert.equal(isTrustedDatasetUrl(result.selectedCandidate.url), true);
      assert.match(result.verifiedDownloadUrl, /^https:\/\//);
      assert.equal(isTrustedDatasetUrl(result.verifiedDownloadUrl), true);

      const csvCheck = validateNormalizedCsv(result.csvText, {
        positiveCount: 10,
        negativeCount: 10,
      });
      assert.equal(csvCheck.ok, true, csvCheck.ok ? "" : csvCheck.reason);
      assert.match(result.csvText, /companion_pos_10/);
      assert.match(result.csvText, /companion_neg_10/);
    },
  );

  it(
    "discovers real customer-service dataset with trusted URLs only",
    { timeout: 180_000 },
    async () => {
      const result = await runAutoFindAgent(
        {
          searchProfile: "外贸 Shopify 客服 转人工 bitext customer service",
          datasetProfile: "customer_service",
          positiveCount: 10,
          negativeCount: 10,
          sessionPrefix: "cs_",
        },
        createDefaultAutoFindDiscoveryDeps(),
      );

      assert.equal(isFictionalDatasetRef(result.selectedCandidate.id), false);
      assert.equal(isTrustedDatasetUrl(result.selectedCandidate.url), true);
      assert.equal(isTrustedDatasetUrl(result.verifiedDownloadUrl), true);

      const csvCheck = validateNormalizedCsv(result.csvText, {
        positiveCount: 10,
        negativeCount: 10,
      });
      assert.equal(csvCheck.ok, true, csvCheck.ok ? "" : csvCheck.reason);
      assert.match(result.csvText, /cs_pos_/);
      assert.match(result.csvText, /cs_neg_/);
    },
  );
});
