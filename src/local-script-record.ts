// Local script evidence records (the interpreter, the script path and what
// reading the file returned, with content signals when it was included) and
// the bounded text they are reported in.

import { analyzeScriptContent } from "./evidence-signals.ts";
import type { FileEvidence } from "./file-evidence.ts";

export function recordFor(
  interpreter: string,
  path: string,
  file: FileEvidence,
): Record<string, unknown> {
  return {
    kind: "local_script",
    interpreter,
    path,
    status: file.status,
    ...(file.reason === undefined ? {} : { reason: file.reason }),
    ...(file.size === undefined ? {} : { size: file.size }),
    ...(file.includedBytes === undefined
      ? {}
      : { includedBytes: file.includedBytes }),
    ...(file.includedSha256 === undefined
      ? {}
      : { includedSha256: file.includedSha256 }),
    ...(file.content === undefined
      ? {}
      : {
          signals: analyzeScriptContent(file.content),
          content: file.content,
        }),
  };
}

export function localScriptText(
  records: Array<Record<string, unknown>>,
  maxChars: number,
): string {
  if (records.length === 0) return "";
  const serialized = JSON.stringify(records, null, 2);
  const bounded =
    serialized.length <= maxChars
      ? serialized
      : `${serialized.slice(0, maxChars)}\n<local_script_enrichment_truncated characters="${serialized.length - maxChars}" />`;
  return `LOCAL_SCRIPT_ANALYSIS\n${bounded}`;
}
