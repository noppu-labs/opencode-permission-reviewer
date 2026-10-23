import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import { V2ReviewerBackend } from "../src/adapters/opencode/v2/reviewer-backend.ts";
import { REVIEWER_SYSTEM_PROMPT } from "../src/modules/context/services/prompt/policy.ts";
import { config, decision } from "./helpers.ts";
import {
  answer,
  returns,
  type StubInput,
  TOOL,
  type V2ReviewFixture,
  v2ReviewFixture,
} from "./v2-review-fixture.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];
type ContextEvent = Parameters<V2ReviewFixture["host"]["context"]>[0];

const event = (
  sessionID: string,
  tools: Record<string, unknown>,
): ContextEvent => ({
  sessionID,
  system: ["host system"],
  messages: ["host history"],
  tools,
});

/** Run `inspect` inside the review's prompt, after the host admitted it. */
function duringPrompt(
  run: V2ReviewFixture,
  inspect: (sessionID: string) => Promise<void>,
): void {
  run.stubs["session.prompt"] = async (input: StubInput): Promise<unknown> => {
    await inspect(`${input.sessionID}`);
    return { id: "inbox_review" };
  };
}

test("an unrelated session keeps its tools and context but loses the reviewer tool", async () => {
  const run = v2ReviewFixture();
  await run.review();
  const unrelated = event("ses_other", { [TOOL]: {}, shell: {} });
  run.host.context(unrelated);
  expect(unrelated).toEqual({
    sessionID: "ses_other",
    system: ["host system"],
    messages: ["host history"],
    tools: { shell: {} },
  });
  run.host.toolHook({ sessionID: "ses_other", tool: "shell" });
  await expect(
    run.host.tool.execute(decision("allow"), { sessionID: "ses_other" }),
  ).rejects.toThrow("Not an active structured reviewer session");
});

test("a structured review sees only its prompt and the reviewer tool until it decides", async () => {
  const run = v2ReviewFixture();
  const seen: ContextEvent[] = [];
  duringPrompt(run, async (sessionID) => {
    const definition = { name: TOOL };
    seen.push(event(sessionID, { [TOOL]: definition, shell: {} }));
    seen.push(event(sessionID, { shell: {} }));
    run.host.context(seen[0] as ContextEvent);
    run.host.context(seen[1] as ContextEvent);
    expect(() => run.host.toolHook({ sessionID, tool: "shell" })).toThrow(
      "Operational tools are disabled in reviewer sessions",
    );
    run.host.toolHook({ sessionID, tool: TOOL });
    await expect(
      run.host.tool.execute({ outcome: "allow" }, { sessionID }),
    ).rejects.toThrow("Invalid review decision");
    expect(
      await run.host.tool.execute(decision("allow"), { sessionID }),
    ).toEqual({
      content: "Decision captured. Finish without further actions.",
    });
    seen.push(event(sessionID, { [TOOL]: definition }));
    run.host.context(seen[2] as ContextEvent);
  });
  expect((await run.review()).kind).toBe("allow");
  const [first, missing, decided] = seen as [
    ContextEvent,
    ContextEvent,
    ContextEvent,
  ];
  expect(JSON.stringify(first.system)).toBe(
    JSON.stringify([
      {
        type: "text",
        text: `${REVIEWER_SYSTEM_PROMPT}\nReturn the decision using ${TOOL} exactly once, then stop.`,
      },
    ]),
  );
  const prompt = (first.messages as [{ content: [{ text: string }] }])[0]
    .content[0].text;
  expect(prompt).toContain("<approval_evidence>");
  expect(JSON.stringify(first.messages)).toBe(
    JSON.stringify([
      { role: "user", content: [{ type: "text", text: prompt }] },
    ]),
  );
  expect(first.tools).toEqual({ [TOOL]: { name: TOOL } });
  expect(missing.tools).toEqual({});
  expect(decided.tools).toEqual({});
});

test("a text review gets the bare system prompt, no tools and no decision tool", async () => {
  const run = v2ReviewFixture({ outputFormat: "text" });
  const seen = event("", {});
  duringPrompt(run, async (sessionID) => {
    Object.assign(seen, event(sessionID, { [TOOL]: {}, shell: {} }));
    run.host.context(seen);
    await expect(
      run.host.tool.execute(decision("allow"), { sessionID }),
    ).rejects.toThrow("Not an active structured reviewer session");
  });
  run.stubs["session.context"] = returns(
    answer({ type: "text", text: JSON.stringify(decision("allow")) }),
  );
  expect((await run.review()).kind).toBe("allow");
  expect(seen.system).toEqual([{ type: "text", text: REVIEWER_SYSTEM_PROMPT }]);
  expect(seen.tools).toEqual({});
});

/** The message `check` throws or rejects with. */
const failure = (check: () => unknown): Promise<string> =>
  Promise.resolve()
    .then(check)
    .then(
      () => "",
      (error: Error) => error.message,
    );

test("a closing review rejects its context, its tools and late decisions", async () => {
  const run = v2ReviewFixture();
  const errors: string[] = [];
  run.stubs["session.interrupt"] = async (
    input: StubInput,
  ): Promise<unknown> => {
    const sessionID = `${input.sessionID}`;
    errors.push(
      await failure(() => run.host.context(event(sessionID, {}))),
      await failure(() => run.host.toolHook({ sessionID, tool: TOOL })),
      await failure(() =>
        run.host.tool.execute(decision("allow"), { sessionID }),
      ),
    );
    return undefined;
  };
  expect((await run.review()).kind).toBe("allow");
  expect(errors).toEqual([
    "Review no longer active",
    "Operational tools are disabled in reviewer sessions",
    "Not an active structured reviewer session",
  ]);
});

type Register = () => Promise<unknown>;

function registrationContext(failing: string): {
  ctx: Context;
  disposed: string[];
} {
  const disposed: string[] = [];
  const register =
    (name: string): Register =>
    async (): Promise<unknown> => ({
      dispose: async (): Promise<void> => void disposed.push(name),
    });
  const handlers: Record<string, Register> = {
    "tool.transform": register("tool.transform"),
    "tool.hook": register("tool.hook"),
    "session.hook": register("session.hook"),
    [failing]: (): Promise<never> =>
      Promise.reject(new Error(`${failing} unavailable`)),
  };
  const ctx = {
    tool: {
      transform: handlers["tool.transform"],
      hook: handlers["tool.hook"],
    },
    session: { hook: handlers["session.hook"] },
  } as unknown as Context;
  return { ctx, disposed };
}

test.each([
  { failing: "session.hook", disposed: ["tool.transform"] },
  { failing: "tool.hook", disposed: ["tool.transform", "session.hook"] },
])(
  "a failed $failing registration disposes the hooks before it",
  async (row) => {
    const { ctx, disposed } = registrationContext(row.failing);
    const backend = new V2ReviewerBackend(ctx, config());
    await expect(backend.register()).rejects.toThrow(
      `${row.failing} unavailable`,
    );
    expect(disposed).toEqual([...row.disposed]);
  },
);

test("registration cleanup disposes every hook", async () => {
  const { ctx, disposed } = registrationContext("none");
  const cleanup = await new V2ReviewerBackend(ctx, config()).register();
  expect(disposed).toEqual([]);
  await cleanup();
  expect(disposed).toEqual(["tool.transform", "session.hook", "tool.hook"]);
});
