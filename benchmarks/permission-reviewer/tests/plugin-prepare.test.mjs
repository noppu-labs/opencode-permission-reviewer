import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../lib/util.mjs";
import { adapter, bashInput, core, textModel } from "./plugin-fixtures.mjs";

const { DEFAULT_CONFIG } = await core("src/modules/config/services/config.ts");
const policy = await core("src/modules/context/services/prompt/policy.ts");
const context = await core("src/modules/context/services/prompt/context.ts");
const parser = await core("src/modules/analysis/capability/command-parser.ts");
const analyzer = await core("src/modules/analysis/capability/bash-analyzer.ts");
const questions = await core(
  "src/modules/reviewer/services/system-one-questions.ts",
);

test("the case config overrides defaults and the model picks model, variant and output format", async () => {
  const input = bashInput();
  input.config = { maxPartChars: 512, riskPolicy: { allow: { low: false } } };
  const cfg = async (model) => (await adapter.prepare(input, model)).config;
  const base = await cfg(undefined);
  assert.deepEqual(Object.keys(base), [
    ...new Set([
      ...Object.keys(DEFAULT_CONFIG),
      "maxPartChars",
      "riskPolicy",
      "model",
      "variant",
      "outputFormat",
      "audit",
      "retainReviewSessions",
    ]),
  ]);
  assert.equal(base.maxPartChars, 512);
  assert.deepEqual(base.riskPolicy, {
    ...DEFAULT_CONFIG.riskPolicy,
    allow: { ...DEFAULT_CONFIG.riskPolicy.allow, low: false },
  });
  assert.equal(base.model, DEFAULT_CONFIG.model);
  assert.equal(base.variant, DEFAULT_CONFIG.variant);
  assert.equal(base.outputFormat, "json_schema");
  assert.equal(base.audit, false);
  assert.equal(base.retainReviewSessions, false);
  const jev = { transport: "system-one", model: "typesafe/jev" };
  assert.equal((await cfg(jev)).model, "commandcode/typesafe/jev");
  assert.equal((await cfg({ ...jev, model: "jev-1" })).model, "jev-1");
  assert.equal((await cfg({ model: "typesafe/jev" })).model, "typesafe/jev");
  assert.equal((await cfg({ model: "m", variant: "low" })).variant, "low");
  assert.equal((await cfg(textModel)).outputFormat, "text");
  assert.equal((await cfg({ format: "tool" })).outputFormat, "json_schema");
});

test("prompts, evidence and hashes follow the model format and the case policy", async () => {
  const input = bashInput();
  input.policyAppend = "Never push.";
  const p = await adapter.prepare(input, { model: "m", format: "tool" });
  const tenant = `${p.config.policy ?? policy.DEFAULT_TENANT_POLICY}\n\n## Trusted case-specific restrictions\nNever push.`;
  assert.equal(
    p.system,
    `${policy.REVIEWER_SYSTEM_PROMPT}\nReturn the decision using permission_reviewer_result exactly once, then stop.`,
  );
  assert.equal(
    p.evidence,
    context.buildEvidenceResult(p.envelope, p.config).text,
  );
  assert.equal(
    p.user,
    policy.buildReviewerPrompt(tenant, p.evidence, "json_schema"),
  );
  const state = {
    trustedPolicy: { reviewer: policy.REVIEWER_SYSTEM_PROMPT, tenant },
    untrustedEvidence: p.evidence,
  };
  assert.deepEqual(p.systemOne, {
    state,
    questions: questions.SYSTEM_ONE_QUESTIONS,
  });
  assert.equal(
    p.promptHash,
    sha256({
      system: p.system,
      user: p.user,
      format: "tool",
      schema: p.schema,
    }),
  );
  assert.equal(p.evidenceHash, sha256(p.evidence));
  assert.deepEqual(p.schema, adapter.schema);
  const plain = await adapter.prepare(bashInput(), undefined);
  assert.equal(plain.system, policy.REVIEWER_SYSTEM_PROMPT);
  assert.equal(
    plain.promptHash,
    sha256({
      system: plain.system,
      user: plain.user,
      format: "text",
      schema: plain.schema,
    }),
  );
  const one = await adapter.prepare(input, {
    model: "jev",
    format: "system_one",
  });
  assert.equal(
    one.promptHash,
    sha256({
      state,
      questions: questions.SYSTEM_ONE_QUESTIONS,
      specVersion: questions.SYSTEM_ONE_SPEC_VERSION,
    }),
  );
});

test("bash commands are parsed and analysed; other requests carry no command analysis", async () => {
  const input = bashInput();
  const { envelope } = await adapter.prepare(input, textModel);
  const parsed = parser.parseCommand(input.request.metadata.command);
  assert.deepEqual(envelope.parsedCommand, parsed);
  assert.deepEqual(
    envelope.capability,
    analyzer.analyzeCapability(parsed, input.directory, input.worktree),
  );
  const edit = bashInput();
  edit.request.permission = "edit";
  const array = bashInput();
  array.request.metadata.command = ["git", "status"];
  const prepared = await Promise.all(
    [edit, array].map((other) => adapter.prepare(other, textModel)),
  );
  for (const { envelope: other } of prepared) {
    assert(!("parsedCommand" in other));
    assert(!("capability" in other));
  }
});

test("the adapter's parsers are the core's decision and System One parsers", async () => {
  const decisions = await core(
    "src/modules/review/services/decision/decision.ts",
  );
  const review = await core("src/modules/reviewer/services/review.ts");
  const { config } = await adapter.prepare(bashInput(), textModel);
  const text = JSON.stringify({ version: 2, outcome: "deny" });
  assert.deepEqual(adapter.parse(text), decisions.parseDecisionFromText(text));
  const object = JSON.parse(text);
  assert.deepEqual(
    adapter.parseObject(object),
    decisions.parseDecision(object),
  );
  const answer = { model: "jev-1", answers: {} };
  assert.deepEqual(
    adapter.parseSystemOne(answer, config),
    review.parseSystemOneReview(answer, config),
  );
  assert.deepEqual(adapter.promptVersion, policy.REVIEWER_PROMPT_VERSION);
});
