import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, sha256 } from "./util.mjs";

// Git blob hashes of the security-critical files actually inspected for this kit.
const PINNED_BLOBS = {
  "src/policy.ts": "e07f0e939ba5446db2d41adca55e976dcabb4575",
  "src/context.ts": "490836e9cfaca23e0f229fd2d0baad7cf542d048",
  "src/context/evidence-sections.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "3e4714cc711443749a897f0f57068ad258f54438",
  "src/context/prompt-budget.ts": "3b169365cc335698751533a86b6040fb2ff39c6a",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/config.ts": "0971f2406a3c05cfe6a023a553abb68e15819e7a",
  "src/decision.ts": "9deb30e0b8d300b5caebb6f2856e86e898064121",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/policy/policy-engine.ts": "ba98b0f450b0048781c3e3bfa7ac7715f16526ce",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/escalation.ts": "bd9a2d78b0516c1278b9fe30fb6b2bea9d262764",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/core/review-engine.ts": "4f8f16766f29d4105a5b1da878645963d511ebe2",
  "src/emergency-brake.ts": "419ccaf0f89cf3aee80d69bdf9e24c094e8634d6",
  "src/redact.ts": "145a65e8ef1b9d1f5eb84256ddeb77565df31fbf",
  "src/capability/command-parser.ts":
    "4188940db8e267afd802da2d65abb5e42a294822",
  "src/capability/bash-analyzer.ts": "88db0f1eed5dfa3bd79a4b2b27152df53ad37349",
  "src/capability/bash-command-tables.ts":
    "e7683cf49e9956942e81dcef76c2be5fe0985e79",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/capability/bash-facts.ts": "5dccd1c7c6909dbe02e7643ff2a8a6747fa98aec",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/capability/bash-mutation.ts": "900220d670a8c6795ffc5b5e4742ff832eab70e6",
  "src/shell-effective-commands.ts": "2451c369acaa602d6236265be49ec407a9126d16",
  "src/shell-lexer.ts": "d62563cfdd2eb71dfaffd70c624fd0de1d05a301",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/element-at.ts": "b1f3846d2751acf6eb693b683154968178bc86d0",
  "src/shell-lexer-tables.ts": "9efdfe8e23a186a9a48cd0b8772777fd90addc2f",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-token.ts": "b3b12c1046ff0b94a41d9a175a5475dc19a17865",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-redirections.ts": "8cb0fd65e22202d460d9d917a5e92b338a194445",
  "src/shell-redirection-operators.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "579703335deab3052f2b1f8b39d34cea10266ba2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-lex-state.ts": "72eac1619909d2b3806d41d91d6674e75a43acb2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-quote-scan.ts": "30acc8301b6b44bc45b742bfcfe7ae536958e0da",
  "src/shell-scanner.ts": "41d5f6c340f3c1bbac2201177d3db600d71e2a35",
  "src/ssh-value-options.ts": "79b1030f4e03d09415238c06cdb0acffdbda2bee",
  "src/capability/heredoc-extractor.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "46cd5995bcfce8b203ae6471968454501209fe68",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/system-one/review.ts": "0d92a58e6befb0bffa66849a8b326c5e9474e437",
};
const gitBlob = (bytes) =>
  createHash("sha1") // NOSONAR(S4790) SHA-1 is git's blob-object hash, compared against git blob IDs, not used for security
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
async function sourceSnapshot(repo) {
  const files = {};
  async function walk(dir, rel = "") {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const d of entries) {
      const relative = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink())
        throw new Error(
          `Source symlink is not supported for a reproducible snapshot: ${relative}`,
        );
      if (d.isDirectory())
        // biome-ignore lint/performance/noAwaitInLoops: the walk must throw at the first symlink before reading any later entry; it also fills the returned files map in sorted depth-first order, which the written snapshot shows (sourceSha256 is key-sorted and does not depend on it)
        await walk(join(dir, d.name), relative);
      else if (/\.(ts|tsx|js|json)$/.test(d.name))
        files[`src/${relative}`] = sha256(
          await readFile(join(dir, d.name)).then((b) => b.toString("utf8")),
        );
    }
  }
  await walk(resolve(repo, "src"));
  const differences = (
    await Promise.all(
      Object.entries(PINNED_BLOBS).map(async ([path, expected]) => ({
        path,
        expected,
        actual: gitBlob(await readFile(resolve(repo, path))),
      })),
    )
  ).filter(({ expected, actual }) => actual !== expected);
  const packageJSON = JSON.parse(
    await readFile(resolve(repo, "package.json"), "utf8"),
  );
  let pinnedCommit = null;
  try {
    // The blob map gates source parity; record the checked-out commit for provenance.
    pinnedCommit = execFileSync(
      "git", // NOSONAR(S4036) resolved via PATH like every other git call; the commit is provenance only
      ["-C", resolve(repo), "rev-parse", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    // A source copy can still be compared by its file hashes without Git metadata.
  }
  return {
    pinnedCommit,
    packageVersion: packageJSON.version,
    inspectedBlobDifferences: differences,
    sourceSha256: sha256(files),
    files,
    match: differences.length === 0,
  };
}
const prov = (value, source = "session-api") => ({
  value,
  source,
  confidence: "high",
});
function humanBlocks(messages) {
  return messages
    .filter((m) => m.info.role === "user")
    .flatMap((m) =>
      m.parts
        .filter(
          (p) =>
            p.type === "text" &&
            typeof p.text === "string" &&
            p.synthetic !== true &&
            p.ignored !== true &&
            !/^Magic Compact:\s*Compaction in progress|^You have \d+ weighted tokens left/i.test(
              p.text.trim(),
            ),
        )
        .map((p) => ({
          actor: "user",
          text: p.text,
          createdAt: m.info.time?.created,
        })),
    );
}
/** Import only the reviewed pure/core layers. Never import index.ts, host backends or evidence providers with filesystem/SSH access. */
export async function openPlugin(
  repo,
  { allowDrift = false, allowNode = false } = {},
) {
  assert(repo, "Provide --repo pointing to your checked-out plugin.");
  if (!process.versions.bun && !allowNode)
    throw new Error(
      "Use Bun for real plugin imports: bun cli.mjs run ... . Node is supported for offline tests/baselines.",
    );
  const snapshot = await sourceSnapshot(repo);
  assert(
    snapshot.match || allowDrift,
    "Inspected plugin files differ from the pinned snapshot. Use the pinned checkout or explicitly pass --allow-drift; differences are recorded.",
  );
  const load = (path) => import(pathToFileURL(resolve(repo, path)).href);
  const [
    policy,
    context,
    config,
    decision,
    escalation,
    engine,
    parser,
    analyzer,
    systemOne,
  ] = await Promise.all([
    load("src/policy.ts"),
    load("src/context.ts"),
    load("src/config.ts"),
    load("src/decision.ts"),
    load("src/escalation.ts"),
    load("src/core/review-engine.ts"),
    load("src/capability/command-parser.ts"),
    load("src/capability/bash-analyzer.ts"),
    load("src/system-one/review.ts"),
  ]);
  assert(
    typeof context.buildEvidenceResult === "function" &&
      typeof engine.evaluateReview === "function",
    "Unsupported core exports.",
  );
  const buildConfig = (input, model) => {
    const base = structuredClone(config.DEFAULT_CONFIG),
      overrides = structuredClone(input.config ?? {});
    return {
      ...base,
      ...overrides,
      riskPolicy: {
        ...base.riskPolicy,
        ...overrides.riskPolicy,
        allow: { ...base.riskPolicy.allow, ...overrides.riskPolicy?.allow },
      },
      model:
        model?.transport === "system-one" && model.model === "typesafe/jev"
          ? "commandcode/typesafe/jev"
          : (model?.model ?? base.model),
      variant: model?.variant ?? base.variant,
      outputFormat: model?.format === "text" ? "text" : "json_schema",
      audit: false,
      retainReviewSessions: false,
    };
  };
  function envelopeFor(input, cfg) {
    const messages = structuredClone(input.messages),
      request = structuredClone(input.request);
    const delegated = input.delegatedSession === true;
    const direct = input.directUserIntent?.length
      ? input.directUserIntent.map((x) =>
          typeof x === "string" ? { actor: "user", text: x } : x,
        )
      : delegated
        ? []
        : humanBlocks(messages);
    const tasks = (input.delegatedTask ?? []).map((x) =>
      typeof x === "string" ? { actor: "assistant", text: x } : x,
    );
    const e = {
      request,
      directory: input.directory,
      worktree: input.worktree,
      transcript: context.buildTranscript(messages, cfg),
      intentHistory: context.buildIntentHistory(messages, cfg, {
        delegatedSession: delegated,
      }),
      enrichment: input.enrichment ?? "",
      sshAudit: [],
      actor: {
        sessionID: request.sessionID,
        agentName: prov(input.actorName ?? "implementer"),
        mode: prov("primary"),
        profile: prov(input.actorProfile ?? "workspace", "global-config"),
        identityCompleteness: "complete",
        rootSessionID: prov(delegated ? "ses_root_fixture" : request.sessionID),
        delegationDepth: prov(delegated ? 1 : 0),
        parentSessionID: prov(delegated ? "ses_root_fixture" : undefined),
      },
      lineage: {
        origin: delegated ? "delegated" : "human-root",
        depth: delegated ? 1 : 0,
        rootSessionID: delegated ? "ses_root_fixture" : request.sessionID,
        cycleDetected: false,
        truncated: false,
        missingParents: [],
        nodes: [
          {
            sessionID: request.sessionID,
            actorName: input.actorName ?? "implementer",
            mode: "primary",
          },
          ...(delegated
            ? [
                {
                  sessionID: "ses_root_fixture",
                  actorName: "coordinator",
                  mode: "primary",
                },
              ]
            : []),
        ],
      },
      intent: {
        directUserIntent: direct,
        delegatedTask: tasks,
        localSessionIntent: delegated
          ? messages
              .filter((m) => m.info.role === "user")
              .flatMap((m) =>
                m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => ({ actor: "assistant", text: p.text })),
              )
          : [],
      },
      actionPurpose: input.actionPurpose,
      ...(input.askDecisions
        ? { askDecisions: structuredClone(input.askDecisions) }
        : {}),
      ...(input.preflightDenial
        ? { preflightDenial: input.preflightDenial }
        : {}),
      ...(input.actionEvidenceComplete === false
        ? { actionEvidenceComplete: false }
        : {}),
    };
    if (
      request.permission === "bash" &&
      typeof request.metadata.command === "string"
    ) {
      e.parsedCommand = parser.parseCommand(request.metadata.command);
      e.capability = analyzer.analyzeCapability(
        e.parsedCommand,
        input.directory,
        input.worktree,
      );
    }
    return e;
  }
  const evaluate = (e, cfg, review) =>
    engine.evaluateReview(e.request, cfg, {
      collect: async () => e,
      review,
      active: () => true,
      auxiliarySession: () => false,
      observe: () => {},
    });
  return {
    snapshot,
    schema: decision.DECISION_SCHEMA,
    promptVersion: policy.REVIEWER_PROMPT_VERSION,
    parse: (text) => decision.parseDecisionFromText(text),
    parseObject: (obj) => decision.parseDecision(obj),
    parseSystemOne: (obj, cfg) => systemOne.parseSystemOneReview(obj, cfg),
    async prepare(input, model) {
      const cfg = buildConfig(input, model),
        envelope = envelopeFor(input, cfg);
      let reached = false;
      const preflight = await evaluate(envelope, cfg, async () => {
        reached = true;
        return {
          kind: "escalate",
          reason: "BENCHMARK preflight: no model invoked.",
          decisionSource: "failure-safe",
        };
      });
      const evidence = context.buildEvidenceResult(envelope, cfg);
      envelope.actionEvidenceComplete =
        envelope.actionEvidenceComplete !== false &&
        evidence.actionEvidenceComplete;
      const tenantPolicy =
        (cfg.policy ?? policy.DEFAULT_TENANT_POLICY) +
        (input.policyAppend
          ? `\n\n## Trusted case-specific restrictions\n${input.policyAppend}`
          : "");
      const user = policy.buildReviewerPrompt(
        tenantPolicy,
        evidence.text,
        cfg.outputFormat,
      );
      const system =
        policy.REVIEWER_SYSTEM_PROMPT +
        (model?.format === "tool"
          ? "\nReturn the decision using permission_reviewer_result exactly once, then stop."
          : "");
      const state = {
        trustedPolicy: {
          reviewer: policy.REVIEWER_SYSTEM_PROMPT,
          tenant: tenantPolicy,
        },
        untrustedEvidence: evidence.text,
      };
      return {
        config: cfg,
        envelope,
        system,
        user,
        evidence: evidence.text,
        schema: decision.DECISION_SCHEMA,
        systemOne: { state, questions: systemOne.SYSTEM_ONE_QUESTIONS },
        reachable: reached,
        bypass: reached ? null : preflight,
        promptHash:
          model?.format === "system_one"
            ? sha256({
                state,
                questions: systemOne.SYSTEM_ONE_QUESTIONS,
                specVersion: systemOne.SYSTEM_ONE_SPEC_VERSION,
              })
            : sha256({
                system,
                user,
                format: model?.format ?? "text",
                schema: decision.DECISION_SCHEMA,
              }),
        evidenceHash: sha256(evidence.text),
        actionEvidenceComplete: envelope.actionEvidenceComplete,
      };
    },
    async finish(prepared, parsed, errorKind, parsedSystemOne) {
      let result;
      if (parsed) {
        result = parsedSystemOne
          ? {
              ...systemOne.enforceParsedSystemOneReview(
                parsedSystemOne,
                prepared.config,
              ),
              decisionSource: "system-one-reviewer",
            }
          : {
              ...decision.enforceDecision(parsed, prepared.config),
              decisionSource: "llm-reviewer",
            };
      } else
        result = escalation.applyEscalationDisposition(
          {
            kind: "escalate",
            reason:
              errorKind === "transport"
                ? "Benchmark provider request failed."
                : "Reviewer returned missing, invalid or ambiguous output.",
            decisionSource: "failure-safe",
          },
          prepared.config,
          errorKind === "transport" ? "reviewer-failure" : "invalid-decision",
        );
      const gated = structuredClone(result);
      const effective = await evaluate(
        prepared.envelope,
        prepared.config,
        async () => structuredClone(result),
      );
      return { gated, effective };
    },
  };
}
