/** The root session the fixtures delegate from; the evidence shows it only for delegated cases. */
const FIXTURE_ROOT = "ses_root_fixture";
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
const asBlocks = (items, actor) =>
  items.map((x) => (typeof x === "string" ? { actor, text: x } : x));
function directIntent(input, messages, delegated) {
  if (input.directUserIntent?.length)
    return asBlocks(input.directUserIntent, "user");
  return delegated ? [] : humanBlocks(messages);
}
const sessionIntent = (messages) =>
  messages
    .filter((m) => m.info.role === "user")
    .flatMap((m) =>
      m.parts
        .filter((p) => p.type === "text")
        .map((p) => ({ actor: "assistant", text: p.text })),
    );
const actorFor = (input, request, delegated) => ({
  sessionID: request.sessionID,
  agentName: prov(input.actorName ?? "implementer"),
  mode: prov("primary"),
  profile: prov(input.actorProfile ?? "workspace", "global-config"),
  identityCompleteness: "complete",
  rootSessionID: prov(delegated ? FIXTURE_ROOT : request.sessionID),
  delegationDepth: prov(delegated ? 1 : 0),
  parentSessionID: prov(delegated ? FIXTURE_ROOT : undefined),
});
const lineageFor = (input, request, delegated) => ({
  origin: delegated ? "delegated" : "human-root",
  depth: delegated ? 1 : 0,
  rootSessionID: delegated ? FIXTURE_ROOT : request.sessionID,
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
      ? [{ sessionID: FIXTURE_ROOT, actorName: "coordinator", mode: "primary" }]
      : []),
  ],
});
const optionalFields = (input) => ({
  ...(input.askDecisions
    ? { askDecisions: structuredClone(input.askDecisions) }
    : {}),
  ...(input.preflightDenial ? { preflightDenial: input.preflightDenial } : {}),
  ...(input.actionEvidenceComplete === false
    ? { actionEvidenceComplete: false }
    : {}),
});
/** The evidence envelope a host would collect for this case, built with the plugin's own context and parsers. */
export function envelopeFor({ context, parser, analyzer }, input, cfg) {
  const messages = structuredClone(input.messages),
    request = structuredClone(input.request);
  const delegated = input.delegatedSession === true;
  const direct = directIntent(input, messages, delegated);
  const tasks = asBlocks(input.delegatedTask ?? [], "assistant");
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
    actor: actorFor(input, request, delegated),
    lineage: lineageFor(input, request, delegated),
    intent: {
      directUserIntent: direct,
      delegatedTask: tasks,
      localSessionIntent: delegated ? sessionIntent(messages) : [],
    },
    actionPurpose: input.actionPurpose,
    ...optionalFields(input),
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
