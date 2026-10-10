import { basename, resolve } from "node:path";
import { elementAt } from "./element-at.ts";
import { localExecutableCommand } from "./evidence/local-command.ts";
import { sourceCommand } from "./evidence/source-command.ts";
import { includeEvidenceFile } from "./evidence-file-reader.ts";
import { analyzeScriptContent } from "./evidence-signals.ts";
import type { FileEvidence } from "./file-evidence.ts";
import type { PermissionRequest } from "./types.ts";
import {
  type ShellCommandSegmentWithDirectory,
  shellCommandSegmentsWithDirectory,
} from "./working-directory-segments.ts";

export interface LocalScriptEnrichmentResult {
  text: string;
}

const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "bun",
  "deno",
  "tsx",
  "bash",
  "sh",
  "zsh",
  "ruby",
  "perl",
]);

const INLINE_CODE_OPTIONS = new Set([
  "-c",
  "-e",
  "--eval",
  "-p",
  "--print",
  "-s",
  "--stdin",
]);
const OPTIONS_WITH_VALUE = new Set([
  "-W",
  "-X",
  "-r",
  "--require",
  "--loader",
  "--import",
  "-I",
  "-M",
  "-m",
]);

// Bun subcommands whose operand names a package or workspace, never a local
// script file. `run` is absent: it accepts a direct file target and is handled
// by the interpreter spec below.
const BUN_SUBCOMMANDS = new Set([
  "add",
  "build",
  "create",
  "install",
  "link",
  "pm",
  "publish",
  "remove",
  "test",
  "unlink",
  "update",
  "x",
]);

interface InterpreterSpec {
  // Subcommands whose first non-option operand executes a local file.
  fileTargetSubcommands?: Set<string>;
  // Options that consume the next token as their value; the value is never
  // the script target.
  valueOptions?: Set<string>;
  // Tokens that OPTIONS_WITH_VALUE consumes for other interpreters but this
  // runtime treats as non-consuming flags (their value syntax is `=`, or they
  // are repeated permission shorts).
  noConsumeOptions?: Set<string>;
  // Options after which the executed file cannot be determined reliably;
  // gathering nothing beats attaching the wrong file.
  bailOptions?: Set<string>;
  // Subcommands whose operand is never a local file.
  nonFileSubcommands?: Set<string>;
  // A subcommand-less invocation still executes a file operand: require the
  // path-like shape so unrecognized subcommands gather nothing.
  directRequiresPathLike?: boolean;
}

// A script operand that names a file. Bare operands may resolve to manifest
// scripts or package specifiers, so only separator- or extension-bearing
// operands are classified as files; anything else conservatively gathers no
// evidence. Scheme-bearing operands (https:, jsr:, npm:, node:, ...) are
// remote or package references, not local paths; this also rejects
// Windows-style drive paths, which never occur in the supported hosts.
function pathLikeFileTarget(token: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(token)) return false;
  return token.includes("/") || /\.(?:[mc]?[jt]sx?)$/i.test(token);
}

// Deno permission shorts and require-equals flags never consume the next
// token even though other runtimes use the same spellings with a value.
const DENO_NO_CONSUME = new Set(["-r", "-W", "-I"]);

// Node flags that consume the next token when written without `=`; tsx
// forwards every flag it does not own, so tsx inherits the same table.
const NODE_VALUE_OPTIONS = new Set([
  "-C",
  "--conditions",
  "--env-file",
  "--env-file-if-exists",
  "--experimental-loader",
  "--test-reporter-destination",
  "--test-reporter",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-shard",
  "--input-type",
  "--inspect-port",
  "--inspect-publish-uid",
  "--diagnostic-dir",
  "--snapshot-blob",
  "--icu-data-dir",
  "--openssl-config",
  "--redirect-warnings",
  "--heapsnapshot-signal",
]);

const INTERPRETER_SPECS: Record<string, InterpreterSpec> = {
  node: {
    valueOptions: NODE_VALUE_OPTIONS,
  },
  bun: {
    fileTargetSubcommands: new Set(["run"]),
    valueOptions: new Set([
      "-F",
      "--filter",
      "--elide-lines",
      "--shell",
      "--env-file",
      "--preload",
      "--tsconfig-override",
    ]),
    bailOptions: new Set(["--cwd", "--config"]),
    nonFileSubcommands: BUN_SUBCOMMANDS,
  },
  deno: {
    fileTargetSubcommands: new Set(["run", "serve", "watch"]),
    valueOptions: new Set([
      "-c",
      "--config",
      "--import-map",
      "--importmap",
      "--conditions",
      "--location",
      "--cert",
      "--ext",
      "--seed",
      "-L",
      "--log-level",
      "--preload",
      "--minimum-dependency-age",
      "--min-dep-age",
      "--inspect-publish-uid",
      "--cpu-prof-dir",
      "--cpu-prof-name",
      "--cpu-prof-interval",
      "--lock",
      "--port",
      "--host",
    ]),
    noConsumeOptions: DENO_NO_CONSUME,
    directRequiresPathLike: true,
  },
  tsx: {
    fileTargetSubcommands: new Set(["watch"]),
    valueOptions: new Set([
      "--tsconfig",
      "--include",
      "--exclude",
      "--ignore",
      "--env-file",
      "--env-file-if-exists",
      "-C",
      "--conditions",
      "--watch-path",
      "--experimental-loader",
      ...NODE_VALUE_OPTIONS,
    ]),
  },
};

function matchesOption(token: string, options: Set<string>): boolean {
  if (options.has(token)) return true;
  return [...options].some((option) => token.startsWith(`${option}=`));
}

// One planner step: stop with the target found so far, or move on, skipping
// `skip` extra tokens consumed as an option value.
type ScanStep =
  | { done: true; target: string | undefined }
  | { done: false; skip: number };

const STOP: ScanStep = { done: true, target: undefined };
const NEXT: ScanStep = { done: false, skip: 0 };
const CONSUME_VALUE: ScanStep = { done: false, skip: 1 };

interface ScanState {
  fileTargetPending: boolean;
  optionsEnded: boolean;
}

function isInformationFlag(token: string, interpreter: string): boolean {
  return (
    ["--help", "--version"].includes(token) ||
    (["node", "bun", "deno", "tsx"].includes(interpreter) && token === "-v") ||
    (["python", "python3"].includes(interpreter) && token === "-V")
  );
}

// A dash spell can mean inline code for one runtime and a valued option for
// another (deno -c is --config, node -c is --check): the interpreter spec wins.
function runsInlineCode(
  token: string,
  spec: InterpreterSpec | undefined,
): boolean {
  const inlineOption = [...INLINE_CODE_OPTIONS].find((option) =>
    option.startsWith("--")
      ? token === option || token.startsWith(`${option}=`)
      : token.startsWith(option),
  );
  return inlineOption !== undefined && !spec?.valueOptions?.has(inlineOption);
}

function stopsBeforeTarget(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
): boolean {
  return (
    isInformationFlag(token, interpreter) ||
    token === "-" ||
    runsInlineCode(token, spec) ||
    token.startsWith("-m") ||
    (spec?.bailOptions !== undefined && matchesOption(token, spec.bailOptions))
  );
}

// The step for a token seen before `--`, or undefined when it is an operand.
function optionStep(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
): ScanStep | undefined {
  if (stopsBeforeTarget(token, interpreter, spec)) return STOP;
  if (spec?.noConsumeOptions?.has(token)) return NEXT;
  if (OPTIONS_WITH_VALUE.has(token) || spec?.valueOptions?.has(token))
    return CONSUME_VALUE;
  if (token.startsWith("-")) return NEXT;
  return;
}

function operandTarget(
  token: string,
  spec: InterpreterSpec | undefined,
  fileTargetPending: boolean,
): string | undefined {
  if (/[$`*?{}<>]/.test(token)) return;
  // The first non-option operand after a file-target subcommand is
  // decisive: a path-like token is the executed file, anything else is a
  // manifest script or package reference.
  if (fileTargetPending) return pathLikeFileTarget(token) ? token : undefined;
  if (spec?.directRequiresPathLike && !pathLikeFileTarget(token)) return;
  if (spec?.nonFileSubcommands?.has(token)) return;
  return token;
}

function scanStep(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
  state: ScanState,
): ScanStep {
  if (!state.optionsEnded) {
    if (token === "--") {
      state.optionsEnded = true;
      return NEXT;
    }
    const step = optionStep(token, interpreter, spec);
    if (step !== undefined) return step;
  } else if (token === "-") return STOP;
  if (spec?.fileTargetSubcommands?.has(token) && !state.fileTargetPending) {
    state.fileTargetPending = true;
    return NEXT;
  }
  return {
    done: true,
    target: operandTarget(token, spec, state.fileTargetPending),
  };
}

function scriptPath(
  tokens: string[],
  interpreterIndex: number,
  interpreter: string,
): string | undefined {
  const spec = INTERPRETER_SPECS[interpreter];
  const state: ScanState = { fileTargetPending: false, optionsEnded: false };
  for (let index = interpreterIndex + 1; index < tokens.length; index += 1) {
    const step = scanStep(
      elementAt(tokens, index, "tokens"),
      interpreter,
      spec,
      state,
    );
    if (step.done) return step.target;
    index += step.skip;
  }
  return;
}

function recordFor(
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

interface InterpreterScript {
  interpreter: string;
  path: string;
}

function interpreterScript(tokens: string[]): InterpreterScript | undefined {
  const command = localExecutableCommand(tokens)?.tokens;
  const executable = command?.[0];
  if (
    command === undefined ||
    executable === undefined ||
    !INTERPRETERS.has(basename(executable))
  )
    return;
  const interpreter = basename(executable);
  const path = scriptPath(command, 0, interpreter);
  return path ? { interpreter, path } : undefined;
}

// A relative script after an unresolved cd has no known location.
function unlocated(
  segment: ShellCommandSegmentWithDirectory,
  path: string,
): boolean {
  return segment.directory === undefined && !path.startsWith("/");
}

function scriptKey(
  script: InterpreterScript,
  segment: ShellCommandSegmentWithDirectory,
  directory: string,
): string {
  return `${script.interpreter}\0${unlocated(segment, script.path) ? `unresolved:${script.path}` : resolve(segment.directory ?? directory, script.path)}`;
}

function unlocatedEvidence(
  path: string,
  segment: ShellCommandSegmentWithDirectory,
): FileEvidence {
  return {
    source: "file",
    path,
    status: "unavailable",
    reason: segment.directoryReason ?? "working directory is unresolved",
  };
}

function localScriptText(
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

export async function enrichLocalScriptEvidence(
  request: PermissionRequest,
  directory: string,
  worktree: string,
  maxChars: number,
): Promise<LocalScriptEnrichmentResult> {
  if (request.permission !== "bash") return { text: "" };
  const segments = shellCommandSegmentsWithDirectory(
    sourceCommand(request),
    directory,
  );
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const script = interpreterScript(segment.tokens);
    if (script === undefined) continue;
    const key = scriptKey(script, segment, directory);
    if (seen.has(key)) continue;
    seen.add(key);
    const file = unlocated(segment, script.path)
      ? unlocatedEvidence(script.path, segment)
      : // biome-ignore lint/performance/noAwaitInLoops: kept sequential on the evidence trust path: the segment count comes from the reviewed command, so one script evidence file is open at a time (includeEvidenceFile closes its handle and retries a missing file once after 100 ms); records are appended in command order
        await includeEvidenceFile(
          script.path,
          segment.directory ?? directory,
          directory,
          worktree,
          maxChars,
        );
    records.push(recordFor(script.interpreter, file.path, file));
  }

  return { text: localScriptText(records, maxChars) };
}
