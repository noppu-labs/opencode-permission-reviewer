import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { OpenCodeEvent } from "@opencode/client";
import { V2AskDecisions } from "../src/opencode/v2/event-codec.ts";
import { normalizeV2Permission } from "../src/opencode/v2/permission-codec.ts";

type Field = {
  key: string;
  title?: string;
  type: string;
  options?: Array<{ value: string; label: string }>;
};

const WORKSPACE = "/workspace";
const scope: Parameters<typeof normalizeV2Permission>[1] = {
  reviewID: "review_codec",
  generation: "generation",
  directory: WORKSPACE,
  hostVersion: "2.0.22",
};

const restores: Array<() => void> = [];
afterEach(() => {
  restores.splice(0).forEach((restore) => {
    restore();
  });
});

function forms(): {
  registry: V2AskDecisions;
  send: (event: Record<string, unknown>) => void;
  created: (id: string, fields: Field[], sessionID?: string) => void;
  replied: (id: string, answer: Record<string, unknown>) => void;
  answers: () => Array<{ question: string; answer: string }>;
} {
  const registry = new V2AskDecisions();
  const send = (event: Record<string, unknown>): void =>
    registry.observe(event as unknown as OpenCodeEvent, WORKSPACE);
  const located = (type: string, data: unknown): void =>
    send({ type, data, location: { directory: WORKSPACE } });
  return {
    registry,
    send,
    created: (id: string, fields: Field[], sessionID = "ses_main"): void =>
      located("form.created", {
        form: { id, sessionID, title: "Scope", fields },
      }),
    replied: (id: string, answer: Record<string, unknown>): void =>
      located("form.replied", { id, sessionID: "ses_main", answer }),
    answers: (): Array<{ question: string; answer: string }> =>
      registry
        .recentFor(["ses_main"], 500)
        .map(({ question, answer }) => ({ question, answer })),
  };
}

const field = (key: string, extra: Partial<Field> = {}): Field => ({
  key,
  type: "string",
  ...extra,
});

function nowAt(time: number): void {
  const spy = spyOn(Date, "now").mockImplementation(() => time);
  restores.push(() => spy.mockRestore());
}

test("native form replies map each field's answer through its option labels", () => {
  const form = forms();
  form.created("form_labels", [
    field("one", {
      title: "First",
      options: [{ value: "read", label: "Read only" }],
    }),
    field("two"),
    field("three", { options: [{ value: "x", label: "X" }] }),
    field("four"),
  ]);
  form.replied("form_labels", { one: ["read", "write"], three: "y", four: 7 });
  expect(form.answers()).toEqual([
    {
      question: "Scope: First | Scope: two | Scope: three | Scope: four",
      answer: "Read only, write | Unanswered | y | 7",
    },
  ]);
});

test("native forms outside the workspace, without a location, from non-session IDs or oversized are ignored", () => {
  const form = forms();
  form.send({
    type: "form.created",
    data: {
      form: {
        id: "form_unlocated",
        sessionID: "ses_main",
        title: "Scope",
        fields: [field("one")],
      },
    },
  });
  form.created("form_foreign", [field("one")], "foreign_main");
  form.created("form_large", [field("one", { title: "x".repeat(64_000) })]);
  form.send({
    type: "form.updated",
    data: { id: "form_unlocated" },
    location: { directory: WORKSPACE },
  });
  ["form_unlocated", "form_foreign", "form_large"].forEach((id) => {
    form.replied(id, { one: "value" });
  });
  expect(form.answers()).toEqual([]);
});

test("native forms keep their first 32 fields", () => {
  const form = forms();
  const fields = Array.from({ length: 40 }, (_, index) => field(`f${index}`));
  form.created("form_wide", fields);
  form.replied("form_wide", {});
  const [decision] = form.answers();
  expect(decision?.question.split(" | ")).toEqual(
    fields.slice(0, 32).map(({ key }) => `Scope: ${key}`),
  );
});

test("native forms keep at most 128 pending and evict the oldest", () => {
  const form = forms();
  Array.from({ length: 129 }, (_, index) =>
    form.created(`form_${index}`, [field("one")]),
  );
  form.replied("form_0", { one: "first" });
  form.replied("form_1", { one: "second" });
  form.replied("form_128", { one: "last" });
  expect(form.answers().map(({ answer }) => answer)).toEqual([
    "second",
    "last",
  ]);
});

test("native forms pending longer than 30 minutes expire on the next event", () => {
  const form = forms();
  const start = 1_000_000;
  nowAt(start);
  form.created("form_kept", [field("one")]);
  form.created("form_expired", [field("one")]);
  nowAt(start + 30 * 60 * 1000);
  form.replied("form_kept", { one: "kept" });
  nowAt(start + 30 * 60 * 1000 + 1);
  form.replied("form_expired", { one: "expired" });
  expect(form.answers().map(({ answer }) => answer)).toEqual(["kept"]);
});

test("V2 permissions map host actions and keep only an object action input as exact evidence", () => {
  const base = {
    action: "shell",
    sessionID: "ses_main",
    effect: "ask" as const,
    resources: ["printf *"],
  };
  const unmapped = normalizeV2Permission(
    { ...base, action: "webfetch" },
    scope,
    [],
  );
  expect(unmapped.request.permission).toBe("webfetch");
  expect(unmapped.request.metadata).toEqual({});
  expect(unmapped.actionEvidenceComplete).toBe(false);
  expect("tool" in unmapped.request).toBe(false);
  expect(unmapped).toMatchObject({
    ...scope,
    host: "v2",
    nativeAction: "webfetch",
    request: { id: scope.reviewID, patterns: ["printf *"], always: [] },
  });
  expect(normalizeV2Permission(base, scope, null).actionEvidenceComplete).toBe(
    false,
  );
  const nonString = normalizeV2Permission(base, scope, { command: 7 });
  expect(nonString.request.metadata).toEqual({ toolInput: { command: 7 } });
  expect(nonString.actionEvidenceComplete).toBe(false);
  const blank = normalizeV2Permission(base, scope, { command: "  " });
  expect(blank.request.metadata.command).toBe("  ");
  expect(blank.actionEvidenceComplete).toBe(false);
  expect(
    normalizeV2Permission({ ...base, action: "read" }, scope, {
      filePath: "a",
    }).actionEvidenceComplete,
  ).toBe(true);
});

test("V2 permissions carry the host agent only as a hint and never trust a supplied one", () => {
  const input = {
    action: "read",
    sessionID: "ses_main",
    effect: "ask" as const,
    resources: [],
    metadata: { hostAgent: "plan", path: "a" },
  };
  expect(normalizeV2Permission(input, scope).request.metadata).toEqual({
    path: "a",
  });
  const hinted = normalizeV2Permission({ ...input, agent: "build" }, scope);
  expect(Object.keys(hinted.request.metadata)).toEqual(["path", "hostAgent"]);
  expect(hinted.request.metadata.hostAgent).toBe("build");
  expect(input.metadata.hostAgent).toBe("plan");
});

describe("host hardening batch 13", () => {
  const valid = { id: "form_bad", sessionID: "ses_main", title: "Scope" };
  const malformed: Array<[string, unknown]> = [
    ["empty fields", { ...valid, fields: [] }],
    ["non-object field", { ...valid, fields: ["one"] }],
    ["null field", { ...valid, fields: [null] }],
    ["non-array fields", { ...valid, fields: "one" }],
    ["missing fields", valid],
    ["non-string session", { ...valid, sessionID: 7, fields: [field("one")] }],
    ["non-string id", { ...valid, id: 7, fields: [field("one")] }],
    ["non-string title", { ...valid, title: 7, fields: [field("one")] }],
    ["non-string key", { ...valid, fields: [{ key: 7 }] }],
    [
      "non-string field title",
      { ...valid, fields: [{ key: "one", title: 7 }] },
    ],
    ["non-array options", { ...valid, fields: [{ key: "one", options: 1 }] }],
    ["null option", { ...valid, fields: [{ key: "one", options: [null] }] }],
    ["array form", [valid]],
    ["no form", undefined],
  ];

  test.each(malformed)("drops each event: %s", (_name, form) => {
    const registry = forms();
    registry.send({
      type: "form.created",
      data: form === undefined ? {} : { form },
      location: { directory: WORKSPACE },
    });
    registry.replied("form_bad", { one: "no" });
    registry.created("form_ok", [field("one")]);
    registry.replied("form_ok", { one: "yes" });
    expect(registry.answers()).toEqual([
      { question: "Scope: one", answer: "yes" },
    ]);
  });

  test.each([
    ["no data", {}],
    ["null data", { data: null }],
    ["array data", { data: [] }],
    ["non-string id", { data: { id: 7, sessionID: "ses_main", answer: {} } }],
    [
      "non-string session",
      { data: { id: "form_ok", sessionID: 7, answer: {} } },
    ],
    [
      "array answer",
      { data: { id: "form_ok", sessionID: "ses_main", answer: [] } },
    ],
    ["missing answer", { data: { id: "form_ok", sessionID: "ses_main" } }],
  ])("drops each settle event: %s", (_name, extra) => {
    const registry = forms();
    registry.created("form_ok", [field("one")]);
    registry.send({
      type: "form.replied",
      ...extra,
      location: { directory: WORKSPACE },
    });
    expect(registry.answers()).toEqual([]);
    registry.replied("form_ok", { one: "yes" });
    expect(registry.answers()).toEqual([
      { question: "Scope: one", answer: "yes" },
    ]);
  });
});

describe("host hardening batch 16", () => {
  test("native form replies keep a field with no reply unanswered", () => {
    const form = forms();
    form.created("form_own", [
      field("constructor"),
      field("toString"),
      field("ok"),
    ]);
    form.replied("form_own", { ok: "yes" });
    expect(form.answers()).toEqual([
      {
        question: "Scope: constructor | Scope: toString | Scope: ok",
        answer: "Unanswered | Unanswered | yes",
      },
    ]);
  });
});
