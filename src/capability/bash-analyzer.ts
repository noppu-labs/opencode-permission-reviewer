import { invariant } from "../invariant.ts";
import { shellBasename } from "../shell-lexer.ts";
import { SHELL_KEYWORDS } from "../shell-lexer-tables.ts";
import {
  CREDENTIAL_READERS,
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
  isLiteralPathValue,
  isRemoteMutationOperand,
  mutationOperands,
  readOnlyToolMutation,
  redirectionWritesPath,
} from "./bash-mutation.ts";
import {
  claimClass,
  claimUnsetClass,
  newCapabilityFacts,
  recordWrite,
} from "./capability-facts.ts";
import { assessmentFrom } from "./capability-report.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "./capability-types.ts";
import { isSensitivePathToken } from "./sensitive-paths.ts";

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

  // Wrappers the lexer peels (sudo, nohup, ssh, …) must be detected on the
  // original segment heads, because `effective` starts at the real executable
  // after peeling. We walk segments skipping shell keywords and VAR=value
  // assignments exactly like the lexer does.
  for (const segment of parsed.segments) {
    let k = 0;
    while (
      k < segment.tokens.length &&
      SHELL_KEYWORDS.has(segment.tokens[k]?.value ?? "")
    )
      k += 1;
    while (
      k < segment.tokens.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment.tokens[k]?.value ?? "")
    ) {
      k += 1;
    }
    const headToken = segment.tokens[k];
    if (headToken !== undefined) {
      const head = shellBasename(headToken.value);
      if (PRIVILEGE_WRAPPERS.has(head)) {
        facts.privilegeEscalation = true;
        facts.childProcesses = true;
      }
      if (PERSISTENCE_WRAPPERS.has(head)) {
        facts.persistence = true;
        facts.childProcesses = true;
      }
      if (SSH_TOOLS.has(head)) {
        facts.remoteEnabled = true;
        facts.childProcesses = true;
        // A remote command that mutates is a remote-mutation hint. The remote
        // command may be a single quoted token (`ssh host 'rm -rf /'`), so split
        // each tail token on whitespace before searching for mutation signals.
        const tail = segment.tokens
          .slice(k + 1)
          .flatMap((t) => t.value.split(/\s+/));
        if (tail.some((v) => GIT_MUTATION_SUBCOMMANDS.has(v) || v === "rm")) {
          facts.remoteMutation = true;
        }
        claimUnsetClass(facts, "remote-operation");
      }
    }
  }

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

  // Deterministic credential reads: a known file reader with a literal
  // credential path operand, or any command with a literal credential path as
  // an input (`<`) redirect target. Wrappers are already peeled in
  // `effective`, so `sudo cat ...` arrives here as `cat ...`. Facts accumulate
  // with OR across every command in the chain.
  for (const [index, cmd] of parsed.effective.entries()) {
    const first = cmd[0];
    if (first === undefined) continue;
    const base = shellBasename(first.value);
    const redirects = parsed.redirections[index] ?? [];
    for (const r of redirects) {
      if (r.operator !== "<") continue;
      if (!isLiteralPathValue(r.target)) continue;
      if (isSensitivePathToken(r.target)) facts.credentialRead = true;
    }
    if (!CREDENTIAL_READERS.has(base)) continue;
    for (let i = 1; i < cmd.length; i += 1) {
      const token = cmd[i];
      const previous = cmd[i - 1];
      invariant(token && previous, "cmd[i - 1] and cmd[i] are in bounds");
      const value = token.value;
      // A token following a redirect operator is that redirect's target, not
      // a path operand: `cat > .env` writes the file, it does not read it.
      const prev = previous.value;
      if (prev === "<" || prev === ">" || prev === ">>" || prev === "<<")
        continue;
      if (/^[0-9]*[<>]/.test(prev)) continue;
      if (value === "--") continue;
      if (value.startsWith("-") && value.length > 1) continue;
      if (value === "<" || value === ">" || value === ">>" || value === "<<")
        continue;
      if (value.startsWith("<") || value.startsWith(">")) continue;
      if (!isLiteralPathValue(value)) continue;
      if (isSensitivePathToken(value)) facts.credentialRead = true;
    }
  }

  // Redirections across all commands.
  for (const segRedirects of parsed.redirections) {
    if (hasWriteRedirect(segRedirects)) {
      for (const r of segRedirects) {
        if (!redirectionWritesPath(r)) continue;
        recordWrite(facts, r.target, roots);
      }
    }
  }

  // Heredoc that writes to a file is a write effect.
  for (const h of parsed.heredocs) {
    if (h.outputTarget !== undefined) {
      recordWrite(facts, h.outputTarget, roots);
    }
  }

  // Action class resolution: prefer the most specific observed surface.
  if (facts.dominantClass === "unknown") {
    if (facts.deletion) {
      facts.dominantClass = "destruction";
      facts.classConfidence = "high";
    } else if (facts.gitMutation) {
      facts.dominantClass = "git-mutation";
      facts.classConfidence = "high";
    } else if (facts.externalWrite) {
      facts.dominantClass = "external-write";
      facts.classConfidence = "high";
    } else if (facts.createsAdHocCode || facts.executesCode) {
      facts.dominantClass = "code-execution";
      facts.classConfidence = facts.createsAdHocCode ? "high" : "medium";
    } else if (facts.invokesPackageLifecycle) {
      facts.dominantClass = "package-management";
      facts.classConfidence = "high";
    } else if (facts.persistence) {
      facts.dominantClass = "persistence";
      facts.classConfidence = "high";
    } else if (facts.privilegeEscalation) {
      facts.dominantClass = "privilege-escalation";
      facts.classConfidence = "high";
    } else if (facts.workspaceWrite) {
      facts.dominantClass = "workspace-write";
      facts.classConfidence = "medium";
    } else if (facts.temporaryWrite) {
      facts.dominantClass = "temporary-write";
      facts.classConfidence = "high";
    } else if (facts.sawUnknownExecutable) {
      // An unrecognized executable is present: report unknown rather than
      // read-only. Absence of detected effects is not evidence of absence.
      facts.dominantClass = "unknown";
      facts.classConfidence = "low";
    } else if (
      facts.sawReadOnlyExecutable ||
      (facts.gitObserved && !facts.gitMutation)
    ) {
      facts.dominantClass = "read-only";
      facts.classConfidence = "medium";
    } else {
      facts.dominantClass = "unknown";
      facts.classConfidence = "low";
    }
  }

  return assessmentFrom(parsed, facts);
}
