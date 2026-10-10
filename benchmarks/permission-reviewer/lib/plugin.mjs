import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, sha256 } from "./util.mjs";

// Git blob hashes of the security-critical files actually inspected for this kit.
const PINNED_BLOBS = {
  "src/policy.ts": "69522b8244cc041dfedbfaf4690706624b2aab80",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context.ts": "e328d5e958f93377a98036188391422c0551dac3",
  "src/context/evidence-sections.ts":
    "9fc5c436c2193c15bc67792cabc73983505f52b3",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/prompt-budget.ts": "36dd6eedf5817478a64eeb5829b8db117082a67c",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/actor-sections.ts": "df48b253d9deb19a73cb661ba7131f8a4772558a",
  "src/context/capability-section.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "f2b1e6b9a5937ff8ad421cef0dd869b028a83e68",
  "src/context/evidence-layout.ts": "35e438dbcdd4b59be5e8829da6293c1ae203799b",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/intent-history.ts": "4f8ef5419a5ccbbbd37a47d93ffe9e265006d85a",
  "src/context/message-summary.ts": "80977fe2e1c286142247e71f7ce0875742451b62",
  "src/context/pending-permission.ts":
    "97ba73673a05a5a9d118098b266b1f6177ea2ad0",
  "src/context/synthetic-parts.ts": "e0cbbc5b83c2d71807b751e6fa864aabacae8d9c",
  "src/config.ts": "c580e3b071ca5e992a1777c53ab6069ecd7c8ab4",
  "src/config-fields.ts": "ad5aa5bcee0d873c523a8b903bf43ed676fabe01",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/config-knobs.ts": "51ead98bd383004dcf0c7afe296d6f9b9f9e5063",
  "src/config-policy-rules.ts": "c114277b0c48c7edba60e15be44f80f84cd6f9d4",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/config-risk-policy.ts": "4c6570a45b0d23cc48dcea2307c9748523b85fa2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/config-rule-condition.ts": "81910452993808d9ab279ae71c4c509ce1ca1166",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/reviewer-model.ts": "8d1b677c93d50d0876f57e2c5e0c76cf235b91fa",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision.ts": "bdd5f4503e71639a282a0e58bf85fec8457b74e2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision-gates.ts": "f54307ffb219fb625546db1a88652ee031c45621",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision-schema.ts": "e60339d6fb71ac232b79c1261a02aae265f05852",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/policy/policy-engine.ts": "a9975ee01dd909ec4c163128561178ca88aa5933",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/policy/policy-conditions.ts": "b116e780cb9dec2b98a9a7509fde194201898c37",
  "src/policy/profile-templates.ts": "a88bfdeb093dba5e7b18c68ed26560efd853045b",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/escalation.ts": "eb7d21b7e1c138315c303a45585a342adef26d44",
  "src/core/review-engine.ts": "fd9f024d04ad81efd1c639a46df1d32114e1a485",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/core/review-result-gates.ts": "2b5c4a8df4e9e0968a9bbe6332f6d3770625357d",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/emergency-brake.ts": "0589f1c4c3a42c911228ed3db8a67b536bca25a5",
  "src/brake-arguments.ts": "4f9e33b37e7a631f058ab9f1663c513151de1593",
  "src/brake-rm-flags.ts": "1b71f4f97cf9bd42f5784c3dde0aae38c838587c",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-root-target.ts": "17c8a09bff9cb9653b332728c637785ddaee7c63",
  "src/brake-find-root.ts": "ee3184c98f08b35bc763ceb12d0bc377b7e5416e",
  "src/brake-block-device.ts": "66af9ea6b35fb1e8e0e941e550e1996b8558c482",
  "src/brake-device-copy.ts": "284ddab26fcb742e25ba644eab95da822cd618dd",
  "src/brake-device-tools.ts": "35e595a9f33eb1af49e9488e33b7afb1452da8db",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-network-export.ts": "f44ec03d976cce0833d3e232b56a2924408c0888",
  "src/redact.ts": "145a65e8ef1b9d1f5eb84256ddeb77565df31fbf",
  "src/capability/command-parser.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "51b07f1137833796f26e45dc2156adaff4433609",
  "src/capability/bash-analyzer.ts": "74fc89978ba4f023c9238d662933c4d2a987edea",
  "src/capability/bash-command-tables.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "73211db1442714db02f6fbb79f47a1548c4a5e86",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/capability/bash-facts.ts": "5dccd1c7c6909dbe02e7643ff2a8a6747fa98aec",
  "src/capability/bash-mutation.ts": "faa0c8d39af857f106d66fed2d54f03ca08acd5a",
  "src/shell-effective-commands.ts": "66e9183f50e24ff07424ffa211ded46dca6ba4ce",
  "src/effective-command-walk.ts": "aedd2ffc4ef201aba00595e543d26e2a0f600421",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-wrapper-options.ts": "9926f878a195ab02df4cc2f22568b83565cef2e9",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-command-strings.ts": "0794d8de3dc08ebc7ac275f7a16f85806aad1751",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/env-split-string.ts": "1e65da835a70a6e8131dc50437c94efe884947a5",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/ssh-remote-command.ts": "64cd51b44423ff524b709f619e90e5650200cc67",
  "src/shell-lexer.ts": "d62563cfdd2eb71dfaffd70c624fd0de1d05a301",
  "src/element-at.ts": "592422429eaad69ccdfa77a80d61ac4e0ea05453",
  "src/shell-lexer-tables.ts": "58c9f179339388419441f59e639ac29549674dc8",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-token.ts": "b3b12c1046ff0b94a41d9a175a5475dc19a17865",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-redirections.ts": "8cb0fd65e22202d460d9d917a5e92b338a194445",
  "src/shell-redirection-operators.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "579703335deab3052f2b1f8b39d34cea10266ba2",
  "src/shell-lex-state.ts": "a44b5716ccba161d751bcc1be39aaf1ffd05e92e",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-quote-scan.ts": "30acc8301b6b44bc45b742bfcfe7ae536958e0da",
  "src/shell-scanner.ts": "f95ccb4dfbe52845197d51ca531e2751fa0372cf",
  "src/ssh-value-options.ts": "79b1030f4e03d09415238c06cdb0acffdbda2bee",
  "src/capability/heredoc-extractor.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "8db082b16ec9ad879f3c6e1271748761a1fbc3c1",
  "src/system-one/review.ts": "3c794bf741679c17a3c6e42dfba6f1b3e41efb7a",
  "src/system-one/system-one-questions.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "5008341e04e7fc87061e82001cfc43b91fd06846",
  "src/system-one/system-one-answers.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "25bf718c2a774da4c4fd5e2780e0d392d770594a",
  "src/system-one/system-one-choices.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "e1109fea7cec6d649b2f14f269c86cd27d56ad37",
  "src/system-one/system-one-consistency.ts":
    "9658f16a6a3ab91e63506906ab41113d5fa77615",
  "src/system-one/system-one-verdict.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "cda97035dfdbe291a11540290d1e235e116480c5",
  "src/capability/capability-facts.ts":
    "9d86550d9c6f8775a3923dac9d1aed51a817f0da",
  "src/capability/capability-report.ts":
    "91e3d8b4ef18becfd7d0bb66dd2b76b80368d343",
  "src/capability/segment-heads.ts": "0591a3d6f45ee63c63f322c54dfa7f2a8b6e6ead",
  "src/capability/action-class.ts": "ea4cf57e8579197fe3b56111c5fe60dd0c3fc9ce",
  "src/capability/sensitive-path-reads.ts":
    "e0db1d3fcb8d89ceee3a4f6ff533417c97b15dff",
  "src/capability/effective-command-classifiers.ts":
    "ab58f309f3c719e607a77687ee2a4aec4ebc51a7",
  "src/capability/executable-recognition.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b1eafef1054206665fed857e749c3337b488f7cb",
  "src/capability/execution-classifiers.ts":
    "c111e9a3dfe91c33b6d69ce74eb791b636f8f1de",
  "src/capability/file-effect-classifiers.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b03fa54cda5b0c69752aad779d8e6123bbd3f320",
  "src/capability/network-classifiers.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b80906f712349b3df832ea319806ac470b733215",
  "src/capability/process-classifiers.ts":
    "b578ec0a5ff7535fab34e1fc2a1ca74af454b699",
  "src/capability/mutation-operands.ts":
    "57dc2a11a4c1885b99f7fb779e062dcae7a214ad",
  "src/capability/read-only-tool-mutations.ts":
    "684c044741a3788a2c504a42a9250bbbafb9ed7a",
  "src/capability/git-subcommand-forms.ts":
    "1f4206bf0cad0d17779c139fd95241ccb5b65b0b",
  "src/capability/heredoc-delimiter.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "abae24b0e331469527d25e6c3719ceea81a8932e",
  "src/capability/heredoc-word-quotes.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b9e1c43faf29d302d48f967ec740a2b9eb7c230c",
  "src/capability/ansi-c-quoting.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "d2f0eabf08316462275c01b7edd4ebac2ef98308",
  "src/capability/heredoc-scan-context.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "f70b351151236060ff9746f8ed766d3f94a4a9df",
  "src/capability/heredoc-bodies.ts":
    "d766923e0629d09e4bba8867d0e27d6739f19d98",
  "src/capability/heredoc-body-records.ts":
    "1a1f75eabf46123da6efe46e7e0df5cabe824ebb",
  "src/capability/heredoc-body-text.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "a2fc69df649d7e71bf683008fbae3c2036b7640b",
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
    decisionGates,
    decisionSchema,
    escalation,
    engine,
    parser,
    analyzer,
    systemOne,
    systemOneQuestions,
  ] = await Promise.all([
    load("src/policy.ts"),
    load("src/context.ts"),
    load("src/config.ts"),
    load("src/decision.ts"),
    load("src/decision-gates.ts"),
    load("src/decision-schema.ts"),
    load("src/escalation.ts"),
    load("src/core/review-engine.ts"),
    load("src/capability/command-parser.ts"),
    load("src/capability/bash-analyzer.ts"),
    load("src/system-one/review.ts"),
    load("src/system-one/system-one-questions.ts"),
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
    schema: decisionSchema.DECISION_SCHEMA,
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
        schema: decisionSchema.DECISION_SCHEMA,
        systemOne: {
          state,
          questions: systemOneQuestions.SYSTEM_ONE_QUESTIONS,
        },
        reachable: reached,
        bypass: reached ? null : preflight,
        promptHash:
          model?.format === "system_one"
            ? sha256({
                state,
                questions: systemOneQuestions.SYSTEM_ONE_QUESTIONS,
                specVersion: systemOneQuestions.SYSTEM_ONE_SPEC_VERSION,
              })
            : sha256({
                system,
                user,
                format: model?.format ?? "text",
                schema: decisionSchema.DECISION_SCHEMA,
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
              ...decisionGates.enforceDecision(parsed, prepared.config),
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
