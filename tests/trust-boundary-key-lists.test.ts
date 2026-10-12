import { describe, expect, test } from "bun:test";
import {
  CONFIDENCE_FLOOR_KEYS,
  TRUST_BOUNDARY_KEYS,
  TRUSTED_ONLY_KEYS,
} from "../src/config/trust-boundary-keys.ts";

/** The keys mergeWithTrustBoundary clamps one by one. */
const CLAMPED = [
  "audit",
  "repositoryTrust",
  "enforcementMode",
  "riskPolicy",
  "escalationMode",
  "policyRules",
];
const trustedOnly: readonly string[] = TRUSTED_ONLY_KEYS;
const floors: readonly string[] = CONFIDENCE_FLOOR_KEYS;

describe("the trust-boundary key lists agree", () => {
  test("every trusted-only key but configDegraded, every floor and every clamped key is a boundary key", () => {
    for (const key of [...trustedOnly, ...floors, ...CLAMPED]) {
      expect([key, TRUST_BOUNDARY_KEYS.has(key)]).toEqual([
        key,
        key !== "configDegraded",
      ]);
    }
  });

  test("every boundary key is trusted-only, a floor, or clamped", () => {
    for (const key of TRUST_BOUNDARY_KEYS) {
      const managed =
        trustedOnly.includes(key) ||
        floors.includes(key) ||
        CLAMPED.includes(key);
      expect([key, managed]).toEqual([key, true]);
    }
  });
});
