import type { EvidenceScope } from "./evidence/provider.ts";
import { sourceCommand } from "./evidence/source-command.ts";
import { type FileEvidence, sha256 } from "./file-evidence.ts";
import {
  findSshIndex,
  parseSsh,
  type SshInvocation,
} from "./ssh-command-segments.ts";
import { sshRecord } from "./ssh-record.ts";
import {
  deterministicDenial,
  pipelineProducer,
  stdinEvidence,
} from "./ssh-stdin-source.ts";
import type { PermissionRequest } from "./types.ts";
import { shellCommandSegmentsWithDirectory } from "./working-directory-segments.ts";

export interface SshAuditSummary {
  destination: string;
  port?: string;
  remoteCommandSha256?: string;
  stdinSource?: string;
  stdinStatus?: string;
  stdinReason?: string;
}

export interface SshEnrichmentResult {
  text: string;
  audit: SshAuditSummary[];
  preflightDenial?: string;
}

export async function enrichSshEvidence(
  request: PermissionRequest,
  directory: string,
  worktree: string,
  maxChars: number,
): Promise<SshEnrichmentResult> {
  if (request.permission !== "bash") return { text: "", audit: [] };
  const command = sourceCommand(request);

  // Track the working directory across `cd` chains, subshell groups, and
  // pipelines (same representation the local-script and git enrichments use)
  // so a stdin source resolves where the producing command runs, not against
  // the ssh segment's directory.
  const segments = shellCommandSegmentsWithDirectory(command, directory);
  const scope: EvidenceScope = { directory, worktree, maxChars };
  const records: Array<Record<string, unknown>> = [];
  const audit: SshAuditSummary[] = [];
  const preflightDenials: string[] = [];

  for (const [segmentIndex, segment] of segments.entries()) {
    const parsed = sshInvocation(segment.tokens);
    if (!parsed) continue;

    const producer = pipelineProducer(segments, segmentIndex);
    // biome-ignore lint/performance/noAwaitInLoops: kept sequential on the evidence trust path: the segment count comes from the reviewed command, so one stdin evidence file is open at a time (includeEvidenceFile closes its handle and retries a missing file once after 100 ms); records, audit entries and preflight denials are appended in command order
    const stdin = await stdinEvidence(segment, producer, scope);
    const remoteCommandSha256 = remoteCommandDigest(parsed);
    const denial = deterministicDenial(stdin);
    if (denial) preflightDenials.push(denial);
    records.push(
      sshRecord(parsed, segment.preceding, stdin, remoteCommandSha256),
    );
    audit.push(auditEntry(parsed, stdin, remoteCommandSha256));
  }

  if (records.length === 0) return { text: "", audit: [] };
  return {
    text: `SSH_ANALYSIS\n${boundedRecords(records, maxChars)}`,
    audit,
    ...(preflightDenials.length === 0
      ? {}
      : { preflightDenial: preflightDenials.join(" ") }),
  };
}

function sshInvocation(tokens: string[]): SshInvocation | undefined {
  const sshIndex = findSshIndex(tokens);
  if (sshIndex < 0) return;
  return parseSsh(tokens, sshIndex);
}

function remoteCommandDigest(parsed: SshInvocation): string | undefined {
  return parsed.remoteCommand ? sha256(parsed.remoteCommand) : undefined;
}

function auditEntry(
  parsed: SshInvocation,
  stdin: FileEvidence | undefined,
  remoteCommandSha256: string | undefined,
): SshAuditSummary {
  return {
    destination: parsed.destination,
    ...(parsed.port === undefined ? {} : { port: parsed.port }),
    ...(remoteCommandSha256 === undefined ? {} : { remoteCommandSha256 }),
    ...(stdin === undefined
      ? {}
      : { stdinSource: stdin.path, stdinStatus: stdin.status }),
    ...(stdin?.reason === undefined ? {} : { stdinReason: stdin.reason }),
  };
}

function boundedRecords(
  records: Array<Record<string, unknown>>,
  maxChars: number,
): string {
  const serialized = JSON.stringify(records, null, 2);
  return serialized.length <= maxChars
    ? serialized
    : `${serialized.slice(0, maxChars)}\n<ssh_enrichment_truncated characters="${serialized.length - maxChars}" />`;
}
