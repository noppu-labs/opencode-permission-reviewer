import assert from "node:assert/strict";
import test from "node:test";
import { adapter, bashInput, message, textModel } from "./plugin-fixtures.mjs";

const prov = (value, source = "session-api") => ({
  value,
  source,
  confidence: "high",
});

test("a root session's direct intent is the visible human text without synthetic, ignored or host-notice parts", async () => {
  const input = bashInput();
  Object.assign(input, { directUserIntent: [], delegatedSession: false });
  input.messages = [
    message("m1", "user", "Ship the parser fix.", {}, 5),
    message("m2", "user", "synthetic", { synthetic: true }),
    message("m3", "user", "ignored", { ignored: true }),
    message("m4", "user", "  Magic Compact: Compaction in progress now"),
    message("m5", "user", "you have 12 weighted tokens left"),
    message("m6", "user", "file part", { type: "file" }),
    message("m7", "assistant", "assistant text"),
    message("m8", "user", "Then stop."),
  ];
  const { envelope } = await adapter.prepare(input, textModel);
  assert.deepEqual(envelope.intent, {
    directUserIntent: [
      { actor: "user", text: "Ship the parser fix.", createdAt: 5 },
      { actor: "user", text: "Then stop.", createdAt: undefined },
    ],
    delegatedTask: [],
    localSessionIntent: [],
  });
  assert.deepEqual(envelope.actor, {
    sessionID: input.request.sessionID,
    agentName: prov(input.actorName),
    mode: prov("primary"),
    profile: prov(input.actorProfile, "global-config"),
    identityCompleteness: "complete",
    rootSessionID: prov(input.request.sessionID),
    delegationDepth: prov(0),
    parentSessionID: prov(undefined),
  });
  assert.deepEqual(envelope.lineage, {
    origin: "human-root",
    depth: 0,
    rootSessionID: input.request.sessionID,
    cycleDetected: false,
    truncated: false,
    missingParents: [],
    nodes: [
      {
        sessionID: input.request.sessionID,
        actorName: input.actorName,
        mode: "primary",
      },
    ],
  });
});

test("given direct intent and delegated tasks map strings to actor blocks and keep objects", async () => {
  const input = bashInput();
  input.directUserIntent = ["Do it.", { actor: "user", text: "Kept", at: 1 }];
  input.delegatedTask = ["Task", { actor: "coordinator", text: "Kept task" }];
  input.delegatedSession = true;
  const { envelope } = await adapter.prepare(input, textModel);
  assert.deepEqual(envelope.intent.directUserIntent, [
    { actor: "user", text: "Do it." },
    { actor: "user", text: "Kept", at: 1 },
  ]);
  assert.deepEqual(envelope.intent.delegatedTask, [
    { actor: "assistant", text: "Task" },
    { actor: "coordinator", text: "Kept task" },
  ]);
});

test("a delegated session reads its user messages as local intent under a fixture root", async () => {
  const input = bashInput();
  Object.assign(input, { directUserIntent: [], delegatedSession: true });
  delete input.actorName;
  delete input.actorProfile;
  input.messages = [
    message("m1", "user", "Inspect src.", {}, 3),
    message("m2", "user", "synthetic", { synthetic: true }),
    message("m3", "user", "file part", { type: "file" }),
    message("m4", "assistant", "assistant text"),
  ];
  const { envelope } = await adapter.prepare(input, textModel);
  assert.deepEqual(envelope.intent, {
    directUserIntent: [],
    delegatedTask: input.delegatedTask,
    localSessionIntent: [
      { actor: "assistant", text: "Inspect src." },
      { actor: "assistant", text: "synthetic" },
    ],
  });
  assert.deepEqual(envelope.actor, {
    sessionID: input.request.sessionID,
    agentName: prov("implementer"),
    mode: prov("primary"),
    profile: prov("workspace", "global-config"),
    identityCompleteness: "complete",
    rootSessionID: prov("ses_root_fixture"),
    delegationDepth: prov(1),
    parentSessionID: prov("ses_root_fixture"),
  });
  assert.deepEqual(envelope.lineage.nodes, [
    {
      sessionID: input.request.sessionID,
      actorName: "implementer",
      mode: "primary",
    },
    {
      sessionID: "ses_root_fixture",
      actorName: "coordinator",
      mode: "primary",
    },
  ]);
  assert.equal(envelope.lineage.origin, "delegated");
  assert.equal(envelope.lineage.depth, 1);
  assert.equal(envelope.lineage.rootSessionID, "ses_root_fixture");
});
