import { shellBasename } from "../shell-lexer.ts";
import { resolveActionClass } from "./action-class.ts";
import {
  DELETION_TOOLS,
  FILE_MUTATION_TOOLS,
  FILE_WRITE_TOOLS,
  GIT_MUTATION_SUBCOMMANDS,
  GIT_NETWORK_SUBCOMMANDS,
  INTERPRETERS,
  NETWORK_CLIENTS,
  NO_EFFECT_BUILTINS,
  PACKAGE_MANAGERS,
  PACKAGE_SUBCOMMANDS,
  PERSISTENCE_TOOLS,
  PERSISTENCE_WRAPPERS,
  PRIVILEGE_WRAPPERS,
  READ_ONLY_TOOLS,
  SERVICE_MANAGERS,
  SSH_TOOLS,
  TEST_RUNNERS,
} from "./bash-command-tables.ts";
import { hasInlineCodeOption } from "./bash-facts.ts";
import {
  destinationFromTokens,
  gitSubcommandMutates,
  gitSubcommandOf,
  hasWriteRedirect,
  isRemoteMutationOperand,
  mutationOperands,
  readOnlyToolMutation,
  redirectionWritesPath,
} from "./bash-mutation.ts";
import {
  type AnalysisRoots,
  type CapabilityFacts,
  claimClass,
  claimUnsetClass,
  newCapabilityFacts,
  recordWrite,
} from "./capability-facts.ts";
import { assessmentFrom } from "./capability-report.ts";
import type {
  CapabilityAssessment,
  HeredocRecord,
  ParsedCommand,
  Redirection,
} from "./capability-types.ts";
import { classifySegmentHeads } from "./segment-heads.ts";
import { classifyCredentialReads } from "./sensitive-path-reads.ts";

/*
 * Bash capability analyzer.
 *
 * Walks a `ParsedCommand` and produces `CapabilityAssessment` facts — each one
 * `Provenanced<boolean | "unknown">` so the reviewer LLM and audit can weigh
 * claims by how reliably they were established. The analyzer never makes a
 * safety decision: it only describes what the action CAN do, what it APPEARS to
 * do, and how completely the command could be analyzed.
 *
 * Reuses the existing lexer's effective-command resolution (wrappers peeled,
 * command-string forms destructured) so privilege prefixes, absolute paths, and
 * `sh -c` bodies are handled consistently with the emergency brake.
 */

// --- analyzer ---------------------------------------------------------------

/** Analyze a parsed bash command and produce capability facts. */
export function analyzeCapability(
  parsed: ParsedCommand,
  directory: string,
  worktree: string,
): CapabilityAssessment {
  const facts = newCapabilityFacts();
  const roots = { directory, worktree };

  const heredocOutputs = new Set(
    parsed.heredocs.map((h) => h.outputTarget).filter(Boolean) as string[],
  );

  classifySegmentHeads(parsed.segments, facts);

  for (const cmd of parsed.effective) {
    const first = cmd[0];
    if (first === undefined) continue;
    const base = shellBasename(first.value);
    // A "usually read-only" executable in a mutating form (find -delete,
    // sort -o, yq -i) is a mutation: surface its effects here and disqualify
    // the read-only classification below.
    const roMutation = readOnlyToolMutation(cmd, base);
    if (roMutation !== undefined) {
      if (roMutation.deletion === true) facts.deletion = true;
      if (roMutation.executesCode === true) {
        facts.executesCode = true;
        facts.childProcesses = true;
      }
      for (const target of roMutation.writeTargets) {
        recordWrite(facts, target, roots);
      }
    }
    // Track whether the executable itself is a known no-effect tool. Commands
    // that match one of the effect families below override this in class
    // resolution; for everything else, an unrecognized executable keeps the
    // class "unknown" instead of defaulting to read-only.
    if (
      (READ_ONLY_TOOLS.has(base) || NO_EFFECT_BUILTINS.has(base)) &&
      roMutation === undefined &&
      !INTERPRETERS.has(base) &&
      !PACKAGE_MANAGERS.has(base) &&
      !NETWORK_CLIENTS.has(base) &&
      !FILE_WRITE_TOOLS.has(base) &&
      !FILE_MUTATION_TOOLS.has(base) &&
      !DELETION_TOOLS.has(base) &&
      !SERVICE_MANAGERS.has(base) &&
      !PERSISTENCE_TOOLS.has(base) &&
      !PRIVILEGE_WRAPPERS.has(base)
    ) {
      facts.sawReadOnlyExecutable = true;
    } else if (
      base !== "git" &&
      !INTERPRETERS.has(base) &&
      !TEST_RUNNERS.has(base) &&
      !PACKAGE_MANAGERS.has(base) &&
      !NETWORK_CLIENTS.has(base) &&
      !SSH_TOOLS.has(base) &&
      !FILE_WRITE_TOOLS.has(base) &&
      !FILE_MUTATION_TOOLS.has(base) &&
      !DELETION_TOOLS.has(base) &&
      !SERVICE_MANAGERS.has(base) &&
      !PERSISTENCE_TOOLS.has(base) &&
      !PERSISTENCE_WRAPPERS.has(base) &&
      !PRIVILEGE_WRAPPERS.has(base)
    ) {
      facts.sawUnknownExecutable = true;
    }

    // Executable detection.
    if (INTERPRETERS.has(base)) {
      facts.executesCode = true;
      if (["bun", "node", "python", "python3", "deno", "tsx"].includes(base)) {
        facts.childProcesses = true;
      }
      const { inline } = hasInlineCodeOption(cmd);
      if (inline) facts.createsAdHocCode = true;
      // If the interpreter targets a generated/heredoc file, it's ad-hoc code.
      for (const token of cmd.slice(1)) {
        const arg = token.value;
        if (heredocOutputs.has(arg)) facts.createsAdHocCode = true;
        if (arg.startsWith(directory) || arg.startsWith(worktree))
          facts.executesRepositoryCode = true;
      }
    }
    if (TEST_RUNNERS.has(base)) {
      facts.invokesTestRunner = true;
      facts.executesCode = true;
      facts.executesRepositoryCode = true;
      facts.childProcesses = true;
    }
    // `<runtime> test` / `<runtime> t` (bun, npm, pnpm, yarn, deno, …). Test
    // invocations always execute code: the runner and the suite itself are
    // executable repository content, so `executesCode` must be true, not
    // unknown (a `read-only` class for `npm test` understates the effect).
    if (INTERPRETERS.has(base) || PACKAGE_MANAGERS.has(base)) {
      const sub = cmd[1]?.value;
      if (
        sub === "test" ||
        sub === "t" ||
        sub === "check" ||
        sub === "verify"
      ) {
        facts.invokesTestRunner = true;
        facts.executesCode = true;
        facts.executesRepositoryCode = true;
        facts.childProcesses = true;
      }
    }
    if (PACKAGE_MANAGERS.has(base)) {
      const sub = cmd[1]?.value;
      const subs = PACKAGE_SUBCOMMANDS[base];
      if (subs === undefined || sub === undefined || subs.has(sub)) {
        facts.invokesPackageLifecycle = true;
        facts.childProcesses = true;
        facts.networkPossible = true;
        if (["run", "exec"].includes(sub ?? "")) {
          facts.executesCode = true;
          if (sub === "run") facts.executesRepositoryCode = true;
        }
        // A local manifest script or installed executable can use the network,
        // but its invocation is not evidence of an actual network operation.
        if (!["run", "exec"].includes(sub ?? "")) facts.networkObserved = true;
      }
    }
    if (NETWORK_CLIENTS.has(base)) {
      facts.networkObserved = true;
      facts.destinations.push(...destinationFromTokens(cmd));
      claimClass(facts, "network");
    }
    if (SSH_TOOLS.has(base)) {
      facts.remoteEnabled = true;
      facts.childProcesses = true;
      // ssh with a remote command that mutates → remote mutation hint.
      if (
        cmd.some(
          (t) => GIT_MUTATION_SUBCOMMANDS.has(t.value) || t.value === "rm",
        )
      ) {
        facts.remoteMutation = true;
      }
      claimClass(facts, "remote-operation");
    }
    if (FILE_WRITE_TOOLS.has(base)) {
      // dd names its output as `of=PATH`; treating the whole assignment as a
      // relative path hides absolute destinations. Other members name output
      // files as ordinary operands.
      const outputOperands =
        base === "dd"
          ? cmd
              .slice(1)
              .map((token) => token.value)
              .filter((value) => value.startsWith("of="))
              .map((value) => value.slice(3))
          : cmd.slice(1).map((token) => token.value);
      for (const output of outputOperands) {
        recordWrite(facts, output, roots);
      }
    }
    if (FILE_MUTATION_TOOLS.has(base)) {
      // cp/mv/ln/rsync: only the DESTINATIONS are writes. Sources of cp and
      // ln are plain reads (`cp /etc/hosts ./hosts` must not report an
      // external write for its source); mv also changes where each source
      // lives, so mv sources count as mutations of their origin location.
      // Remote destinations (`user@host:/srv/app`, rsync://…) are external
      // writes on another machine, whatever a relative-looking local
      // classification would say.
      const { sources, destinations, sawOperand } = mutationOperands(base, cmd);
      const optionEnd = cmd.findIndex((token) => token.value === "--");
      const mutatesSources =
        base === "mv" ||
        (base === "rsync" &&
          cmd
            .slice(1, optionEnd < 0 ? cmd.length : optionEnd)
            .some((token) => token.value === "--remove-source-files"));
      const writeOperands = mutatesSources
        ? [...destinations, ...sources]
        : destinations;
      for (const operand of writeOperands) {
        if (base === "rsync" && isRemoteMutationOperand(operand)) {
          facts.externalWrite = true;
          continue;
        }
        recordWrite(facts, operand, roots);
      }
      if (!sawOperand) facts.workspaceWrite = true;
    }
    if (DELETION_TOOLS.has(base)) {
      facts.deletion = true;
      let anyTarget = false;
      for (const token of cmd.slice(1)) {
        const v = token.value;
        if (v.startsWith("-")) continue;
        anyTarget = true;
        recordWrite(facts, v, roots);
      }
      if (!anyTarget) facts.workspaceWrite = true;
    }
    if (base === "git") {
      facts.gitObserved = true;
      const { sub, index } = gitSubcommandOf(cmd);
      if (sub !== undefined && GIT_NETWORK_SUBCOMMANDS.has(sub)) {
        facts.networkObserved = true;
      }
      if (
        sub !== undefined &&
        index !== undefined &&
        gitSubcommandMutates(cmd, sub, index)
      ) {
        facts.gitMutation = true;
        if (sub === "push") facts.externalWrite = true;
        else facts.workspaceWrite = true;
      } else if (sub !== undefined && GIT_NETWORK_SUBCOMMANDS.has(sub)) {
        claimClass(facts, "network");
      }
    }
    if (PRIVILEGE_WRAPPERS.has(base)) {
      // Privilege wrappers were already detected on the segment head above;
      // the lexer peels them so `effective` starts at the real executable.
    }
    if (SERVICE_MANAGERS.has(base)) {
      facts.persistence = true;
      facts.childProcesses = true;
      facts.privilegeEscalation = true;
      claimUnsetClass(facts, "service-management");
    }
    if (PERSISTENCE_TOOLS.has(base)) {
      facts.persistence = true;
      facts.childProcesses = true;
    }
    // Background operator `&` is already a segment separator; `disown`/`nohup`
    // are handled above. A trailing `&` inside one logical command is rare with
    // our lexer but `setsid`/`nohup` cover the common persistence cases.
  }

  classifyCredentialReads(parsed, facts);
  recordRedirectionWrites(parsed.redirections, facts, roots);
  recordHeredocWrites(parsed.heredocs, facts, roots);
  resolveActionClass(facts);

  return assessmentFrom(parsed, facts);
}

/** Redirections across all commands. */
function recordRedirectionWrites(
  redirections: Redirection[][],
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  for (const segRedirects of redirections) {
    if (!hasWriteRedirect(segRedirects)) continue;
    for (const r of segRedirects) {
      if (redirectionWritesPath(r)) recordWrite(facts, r.target, roots);
    }
  }
}

/** A heredoc that writes to a file is a write effect. */
function recordHeredocWrites(
  heredocs: HeredocRecord[],
  facts: CapabilityFacts,
  roots: AnalysisRoots,
): void {
  for (const h of heredocs) {
    if (h.outputTarget !== undefined) recordWrite(facts, h.outputTarget, roots);
  }
}
