import { isAbsolute } from "node:path";
import { sourceCommand } from "./evidence/source-command.ts";
import {
  type FileEvidence,
  includeEvidenceFile,
  isMissingFile,
  sha256,
} from "./evidence-file-reader.ts";
import { catSource, findSshIndex, parseSsh } from "./ssh-command-segments.ts";
import type { PermissionRequest } from "./types.ts";
import {
  type ShellCommandSegmentWithDirectory,
  shellCommandSegmentsWithDirectory,
} from "./working-directory-segments.ts";

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

function deterministicDenial(
  stdin: FileEvidence | undefined,
): string | undefined {
  if (!stdin) return;
  if (isMissingFile(stdin)) {
    return `The file sent over stdin does not exist after a second check: ${stdin.path}. Create it and retry the command.`;
  }
  return;
}

function commandSignals(
  remoteCommand: string,
  hasStdin: boolean,
): Record<string, boolean> {
  return {
    stagingHint: /\bstag(?:e|ing)?\b/i.test(remoteCommand),
    productionHint: /\bprod(?:uction)?\b/i.test(remoteCommand),
    executesStdin:
      hasStdin &&
      /\b(?:python(?:3)?|bash|sh|node|ruby|perl)\s+-$/.test(remoteCommand),
    secretReadHint:
      /\b(?:env|printenv)\b|(?:^|[\s/])\.env\b|\/proc\/\d+\/environ\b|(?:cat|sed|grep)\s+[^\n;]*(?:credential|secret|token|private[_-]?key)/i.test(
        remoteCommand,
      ),
    mutationHint:
      /\b(?:rm|mv|cp|install|deploy|restart|stop|start|kill|reboot|shutdown|chmod|chown|truncate|tee|docker\s+(?:rm|restart|stop|kill|compose\s+(?:up|down))|kubectl\s+(?:apply|delete|patch|rollout)|systemctl\s+(?:restart|stop|start|enable|disable))\b/i.test(
        remoteCommand,
      ),
  };
}

export function analyzeScriptContent(content: string): Record<string, unknown> {
  const outboundUrls = [
    ...content.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g),
  ]
    .map((match) => match[0])
    .slice(0, 8);
  return {
    credentialPathReadHint:
      /(?:read_text|read_bytes|open)\s*\([^)]*(?:\.ssh\/id_|\.aws\/credentials|\.env\b|credential|private[_-]?key)/i.test(
        content,
      ) ||
      /Path\s*\([^)]*(?:\.ssh\/id_|\.aws\/credentials|\.env\b|credential|private[_-]?key)[^)]*\)\s*\.\s*(?:read_text|read_bytes|open)/i.test(
        content,
      ),
    environmentEnumerationHint:
      /\bos\.environ\b|\bprocess\.env\b|\bprintenv\b|(?:^|[^\w])env(?:[^\w]|$)/m.test(
        content,
      ),
    networkUploadHint:
      /\brequests?\.(?:post|put|patch)\s*\(|\burlopen\s*\([^)]*(?:data\s*=|Request)|\bmethod\s*=\s*["'](?:POST|PUT|PATCH)["']|\bcurl\b[^\n]*(?:--data|-d\b|-T\b|--upload-file)/i.test(
        content,
      ),
    dynamicExecutionHint:
      /\b(?:exec|eval|compile)\s*\(|\bsubprocess\.(?:run|Popen|call)\s*\(|\bos\.system\s*\(|\bchild_process\.(?:exec|spawn)\s*\(/i.test(
        content,
      ),
    fileMutationHint:
      /\.(?:write_text|write_bytes|unlink|rename|replace)\s*\(|\bopen\s*\([^)]*,\s*["'][wax+]|\bshutil\.(?:rmtree|move|copy|copy2)\s*\(|\bos\.(?:remove|unlink|rename|replace)\s*\(/i.test(
        content,
      ),
    databaseMutationHint:
      /\b(?:alter|drop|truncate|delete\s+from|update|insert\s+into|create\s+(?:table|index)|grant|revoke)\b/i.test(
        content,
      ),
    outboundUrls,
  };
}

function stdinSignals(
  stdin: FileEvidence | undefined,
): Record<string, unknown> | undefined {
  if (!stdin?.content) return;
  return analyzeScriptContent(stdin.content);
}

type SshInvocation = NonNullable<ReturnType<typeof parseSsh>>;

interface StdinReadScope {
  directory: string;
  worktree: string;
  maxChars: number;
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
  const scope: StdinReadScope = { directory, worktree, maxChars };
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

// The pipeline producer runs where IT runs, not where ssh runs: a group
// like `(cd sub && cat p.py) | ssh …` reads the stdin file from sub even
// though ssh itself executes in the outer directory. Walk back over
// paren markers to the producing command.
// A negative index reads `undefined`, which ends the walk at the start.
function pipelineProducer(
  segments: ShellCommandSegmentWithDirectory[],
  segmentIndex: number,
): ShellCommandSegmentWithDirectory | undefined {
  let producerIndex = segmentIndex - 1;
  let producer = segments[producerIndex];
  while (producer !== undefined && producer.tokens.length === 0) {
    producerIndex -= 1;
    producer = segments[producerIndex];
  }
  return producer;
}

async function stdinEvidence(
  segment: ShellCommandSegmentWithDirectory,
  producer: ShellCommandSegmentWithDirectory | undefined,
  scope: StdinReadScope,
): Promise<FileEvidence | undefined> {
  const stdinPath =
    segment.preceding === "|" && producer
      ? catSource(producer.tokens)
      : undefined;
  if (stdinPath === undefined) return undefined;
  if (
    producer !== undefined &&
    producer.directory === undefined &&
    !isAbsolute(stdinPath)
  ) {
    return {
      source: "file",
      path: stdinPath,
      status: "unavailable",
      reason:
        producer.directoryReason ??
        "working directory of the pipeline producer is unresolved",
    };
  }
  return includeEvidenceFile(
    stdinPath,
    producer?.directory ?? segment.directory ?? scope.directory,
    scope.directory,
    scope.worktree,
    scope.maxChars,
  );
}

function sshRecord(
  parsed: SshInvocation,
  preceding: string | undefined,
  stdin: FileEvidence | undefined,
  remoteCommandSha256: string | undefined,
): Record<string, unknown> {
  const analyzedStdin = stdinSignals(stdin);
  return {
    kind: "ssh",
    destination: parsed.destination,
    host: parsed.host,
    ...(parsed.user === undefined ? {} : { user: parsed.user }),
    ...(parsed.port === undefined ? {} : { port: parsed.port }),
    ...(parsed.identityFile === undefined
      ? {}
      : { identityFile: parsed.identityFile }),
    ...(parsed.strictHostKeyChecking === undefined
      ? {}
      : { strictHostKeyChecking: parsed.strictHostKeyChecking }),
    remoteCommand: parsed.remoteCommand || "<interactive or unspecified>",
    ...(remoteCommandSha256 === undefined ? {} : { remoteCommandSha256 }),
    signals: commandSignals(parsed.remoteCommand, stdin !== undefined),
    ...(analyzedStdin === undefined ? {} : { stdinSignals: analyzedStdin }),
    ...stdinField(stdin, preceding),
  };
}

function stdinField(
  stdin: FileEvidence | undefined,
  preceding: string | undefined,
): Record<string, unknown> {
  if (stdin !== undefined) return { stdin };
  return preceding === "|"
    ? {
        stdin: {
          status: "unresolved",
          reason: "pipeline producer is not one regular cat file",
        },
      }
    : {};
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
