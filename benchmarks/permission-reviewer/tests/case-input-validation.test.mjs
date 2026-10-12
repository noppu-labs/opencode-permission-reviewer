import assert from "node:assert/strict";
import test from "node:test";
import { validateCases } from "../lib/dataset.mjs";
import { data, id, rejects } from "./case-fixtures.mjs";

test("request, message, path and config shapes are checked in order", () => {
  const request = (change) => (cs) => change(cs[0].input.request);
  const table = [
    [(cs) => delete cs[0].input.request, `${id}: request schema`],
    [request((r) => (r.permission = 1)), `${id}: request schema`],
    [request((r) => (r.patterns = "git")), `${id}: request schema`],
    [request((r) => (r.patterns = [1])), `${id}: request schema`],
    [request((r) => (r.always = null)), `${id}: request schema`],
    [request((r) => (r.metadata = null)), `${id}: request schema`],
    [request((r) => (r.metadata = "x")), `${id}: request schema`],
    [request((r) => (r.id = 1)), `${id}: request identities`],
    [request((r) => delete r.sessionID), `${id}: request identities`],
    [(cs) => (cs[0].input.messages = {}), `${id}: messages`],
    [(cs) => (cs[0].input.messages = [{ parts: [] }]), `${id}: messages`],
    [(cs) => (cs[0].input.messages = [{ info: {} }]), `${id}: messages`],
    [(cs) => delete cs[0].input.directory, `${id}: paths`],
    [(cs) => (cs[0].input.worktree = 1), `${id}: paths`],
    [
      (cs) => (cs[0].input.config = { model: "x" }),
      `${id}: unsupported case config model`,
    ],
    [
      (cs) => (cs[0].input.config = { maxPartChars: 0 }),
      `${id}: invalid config budget maxPartChars`,
    ],
    [
      (cs) => (cs[0].input.config = { maxContextChars: "9" }),
      `${id}: invalid config budget maxContextChars`,
    ],
    [
      (cs) => (cs[0].input.config = { transcriptMessages: 1.5 }),
      `${id}: invalid config budget transcriptMessages`,
    ],
  ];
  for (const [mutate, message] of table) rejects(mutate, message);
});

test("an input repeated under new request identities is rejected", () => {
  rejects((cs) => {
    const copy = structuredClone(cs[0].input);
    copy.request.id = "another-request";
    copy.request.sessionID = "another-session";
    copy.request.tool = { messageID: "m", callID: "c" };
    cs[1].input = copy;
  }, `${data.cases[1].id}: exact duplicate model input`);
});

test("attack and metamorphic pairs need a source in the same family, split and gold", () => {
  const attackAt = data.cases.findIndex((c) => c.attack);
  const pairAt = data.cases.findIndex((c) => c.metamorphic);
  const pair = data.cases[pairAt];
  const otherFamily = data.cases.find(
    (c) => c.family !== pair.family && c.split === pair.split,
  );
  const otherGold = data.cases.find(
    (c) =>
      c.family === pair.family &&
      c.split === pair.split &&
      c.gold.outcome !== pair.gold.outcome,
  );
  assert(otherFamily && otherGold);
  rejects(
    (cs) => (cs[attackAt].attack.controlId = "prb_missing"),
    `${data.cases[attackAt].id}: missing paired source prb_missing`,
  );
  rejects(
    (cs) => (cs[pairAt].metamorphic.sourceId = "prb_missing"),
    `${pair.id}: missing paired source prb_missing`,
  );
  rejects(
    (cs) => (cs[pairAt].metamorphic.sourceId = otherFamily.id),
    `${pair.id}: pair leakage across family/partition`,
  );
  rejects(
    (cs) => (cs[pairAt].metamorphic.sourceId = otherGold.id),
    `${pair.id}: preservation pair has inconsistent gold`,
  );
});

test("the validation summary sorts categories and counts each outcome", () => {
  const summary = validateCases(structuredClone(data.cases.slice(0, 2)));
  assert.deepEqual(Object.keys(summary), [
    "cases",
    "families",
    "categories",
    "outcomes",
  ]);
  assert.equal(summary.cases, 2);
  assert.deepEqual(
    summary.categories,
    [...new Set(data.cases.slice(0, 2).map((c) => c.category))].sort(),
  );
  assert.deepEqual(Object.keys(summary.outcomes), [
    "allow",
    "deny",
    "escalate",
  ]);
});
