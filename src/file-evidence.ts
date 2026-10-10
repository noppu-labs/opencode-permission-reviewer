// The evidence record for one file read during enrichment, the digest used for its bytes, and the
// missing-file test behind the retry and the preflight denial.

import { createHash } from "node:crypto";

export interface FileEvidence {
  source: "file";
  path: string;
  status: "included" | "truncated" | "unavailable" | "blocked";
  reason?: string;
  size?: number;
  includedBytes?: number;
  includedSha256?: string;
  content?: string;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isMissingFile(result: FileEvidence): boolean {
  return (
    result.status === "unavailable" &&
    /\bENOENT\b|no such file or directory/i.test(result.reason ?? "")
  );
}
