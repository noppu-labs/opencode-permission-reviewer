import assert from "node:assert/strict";
import test from "node:test";
import { adapter, bashInput, core, textModel } from "./plugin-fixtures.mjs";

const context = await core("src/modules/context/services/prompt/context.ts");

test("the envelope copies its inputs, adds optional fields only when given and keeps its key order", async () => {
  const input = bashInput();
  delete input.enrichment;
  delete input.actionPurpose;
  const plain = await adapter.prepare(input, textModel);
  assert.deepEqual(Object.keys(plain.envelope), [
    "request",
    "directory",
    "worktree",
    "transcript",
    "intentHistory",
    "enrichment",
    "sshAudit",
    "actor",
    "lineage",
    "intent",
    "actionPurpose",
    "parsedCommand",
    "capability",
    "policyTrace",
    "actionEvidenceComplete",
  ]);
  assert.equal(plain.envelope.enrichment, "");
  assert.equal(plain.envelope.actionPurpose, undefined);
  assert.notEqual(plain.envelope.request, input.request);
  assert.deepEqual(
    plain.envelope.transcript,
    context.buildTranscript(input.messages, plain.config),
  );
  assert.deepEqual(
    plain.envelope.intentHistory,
    context.buildIntentHistory(input.messages, plain.config, {
      delegatedSession: false,
    }),
  );
  assert.equal(plain.reachable, true);
  assert.equal(plain.bypass, null);
  input.askDecisions = [{ at: 1, question: "Push?", answer: "Yes" }];
  input.preflightDenial = "SSH preflight denied.";
  input.actionEvidenceComplete = false;
  const full = await adapter.prepare(input, textModel);
  assert.deepEqual(Object.keys(full.envelope).slice(10, 14), [
    "actionPurpose",
    "askDecisions",
    "preflightDenial",
    "actionEvidenceComplete",
  ]);
  assert.notEqual(full.envelope.askDecisions, input.askDecisions);
  assert.deepEqual(full.envelope.askDecisions, input.askDecisions);
  assert.equal(full.actionEvidenceComplete, false);
  assert.equal(full.reachable, false);
  assert.equal(full.bypass.kind, "deny");
  assert.equal(full.bypass.reason, "SSH preflight denied.");
});
