// The bytes read for evidence: read from the verified descriptor, then classified. Binary or
// credential-bearing content is blocked, the rest is included or marked truncated.

import type { FileHandle } from "node:fs/promises";
import { type FileEvidence, sha256 } from "./file-evidence.ts";

const SENSITIVE_CONTENT =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk|nvapi)-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9_-]{16,}|\bgithub_pat_[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i;

// A single read is not guaranteed to fill the buffer, so loop until
// full or EOF. A short total means the file shrank mid-read; the status
// then reports truncation instead of silently covering fewer
// bytes than the size claims.
export async function fillBuffer(
  handle: FileHandle,
  buffer: Buffer,
): Promise<number> {
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    // biome-ignore lint/performance/noAwaitInLoops: each read fills the buffer from the offset where the previous read stopped, and a zero-byte read ends the loop at EOF
    const { bytesRead: count } = await handle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      bytesRead,
    );
    if (count === 0) break;
    bytesRead += count;
  }
  return bytesRead;
}

export function contentEvidence(
  path: string,
  buffer: Buffer,
  bytesRead: number,
  size: number,
  limit: number,
): FileEvidence {
  const shortRead = bytesRead < buffer.length;
  const included = buffer.subarray(0, Math.min(bytesRead, limit));
  const content = included.toString("utf8");
  const replacementCount = [...content].filter(
    (character) => character === "\uFFFD",
  ).length;
  if (
    included.includes(0) ||
    replacementCount > Math.max(2, content.length / 100)
  ) {
    return {
      source: "file",
      path,
      status: "blocked",
      reason: "binary or non-text content",
      size,
    };
  }
  if (SENSITIVE_CONTENT.test(content)) {
    return {
      source: "file",
      path,
      status: "blocked",
      reason: "possible literal credential or private key",
      size,
      includedSha256: sha256(included),
    };
  }
  return {
    source: "file",
    path,
    status: size > limit || shortRead ? "truncated" : "included",
    size,
    includedBytes: included.length,
    includedSha256: sha256(included),
    content,
  };
}
