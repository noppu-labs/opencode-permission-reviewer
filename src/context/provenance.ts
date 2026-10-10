// The provenance wrapper every resolved actor, lineage and intent fact is built with.

import type {
  EvidenceConfidence,
  Provenanced,
} from "../actor-context-types.ts";

export function prov<T>(
  value: T,
  source: Provenanced<T>["source"],
  confidence: EvidenceConfidence,
  notes?: string[],
): Provenanced<T> {
  return notes === undefined
    ? { value, source, confidence }
    : { value, source, confidence, notes };
}
