// Evidence for a verified ssh script: the local file read under the evidence-root checks and
// accepted only when it matches the command's hash, or a remembered analysis of those bytes.

import { includeEvidenceFile } from "./evidence-file-reader.ts";
import type { FileEvidence } from "./file-evidence.ts";
import { redactSecrets } from "./redact.ts";
import type { VerifiedScriptCommand } from "./verified-ssh-command.ts";
import {
  type ScriptAnalysisRegistry,
  VERIFIED_SCRIPT_LIMIT,
  type VerifiedScriptEvidence,
} from "./verified-ssh-script.ts";

export async function collectVerifiedSshScript(
  command: VerifiedScriptCommand,
  directory: string,
  worktree: string,
  scope: string,
  configHash: string,
  registry: ScriptAnalysisRegistry,
): Promise<VerifiedScriptEvidence> {
  const base = {
    sha256: command.sha256,
    destination: command.destination,
    ...(command.port === undefined ? {} : { port: command.port }),
    shell: command.shell,
  };
  const file = await includeEvidenceFile(
    command.path,
    directory,
    directory,
    worktree,
    VERIFIED_SCRIPT_LIMIT,
  );
  const reason = unavailableReason(file, command.sha256);
  if (reason !== undefined) {
    return {
      ...base,
      status: "unavailable",
      text: `VERIFIED_SSH_SCRIPT\nstatus: unavailable\nreason: ${reason}\nExpected SHA-256: ${command.sha256}`,
    };
  }
  const cacheKey = registry.key(scope, command, configHash);
  const analysis = registry.get(cacheKey);
  const bytes = file.size === undefined ? {} : { bytes: file.size };
  if (analysis !== undefined) {
    return {
      ...base,
      ...bytes,
      status: "reused",
      cacheKey,
      text: `VERIFIED_SSH_SCRIPT\nstatus: previously inspected\nSHA-256: ${command.sha256}\nDestination: ${command.destination}\nInterpreter: ${command.shell}\nPrior model-generated script analysis (not authorization): ${analysis}`,
    };
  }
  return {
    ...base,
    ...bytes,
    status: "full",
    cacheKey,
    text: `VERIFIED_SSH_SCRIPT\nstatus: full content\nSHA-256: ${command.sha256}\nDestination: ${command.destination}\nInterpreter: ${command.shell}\nUntrusted script content follows:\n${file.content}\nEND_VERIFIED_SSH_SCRIPT`,
  };
}

/** Why the local file cannot stand for the verified script: not fully
 *  included, a different hash, or content the redactor would change. */
function unavailableReason(
  file: FileEvidence,
  expectedSha256: string,
): string | undefined {
  const actual = file.content === undefined ? undefined : file.includedSha256;
  if (
    file.status !== "included" ||
    actual !== expectedSha256 ||
    file.content === undefined ||
    redactSecrets(file.content) !== file.content
  ) {
    return file.status === "included" && actual !== expectedSha256
      ? "script hash mismatch"
      : file.status === "included"
        ? "sensitive content"
        : file.status;
  }
  return undefined;
}
