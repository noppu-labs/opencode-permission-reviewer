import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import type { z } from "zod";
import { REVIEWER_SYSTEM_PROMPT } from "../../../modules/context/services/prompt/policy.ts";
import { parseDecision } from "../../../modules/review/services/decision/decision.ts";
import {
  type PendingGeneration,
  resultSchema,
  TOOL,
} from "./v2-review-pending.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];
type Sessions = Map<string, PendingGeneration>;

function captureDecision(
  pending: PendingGeneration | undefined,
  input: z.infer<typeof resultSchema>,
): { content: string } {
  if (!pending?.attempt.active() || pending.closing || !pending.structured)
    throw new Error("Not an active structured reviewer session");
  const decision = parseDecision(input);
  if (!decision) throw new Error("Invalid review decision");
  pending.results.push(decision);
  if (pending.results.length > 1)
    throw new Error("Multiple review decisions are ambiguous");
  return {
    content: "Decision captured. Finish without further actions.",
  };
}

/** Replace a reviewer session's context with its own prompt and decision tool. */
function isolateContext(
  pending: PendingGeneration | undefined,
  event: SessionContext,
): void {
  if (!pending) {
    delete event.tools[TOOL];
    return;
  }
  if (pending.closing || !pending.attempt.active())
    throw new Error("Review no longer active");
  event.system = [
    {
      type: "text",
      text:
        REVIEWER_SYSTEM_PROMPT +
        (pending.structured
          ? `\nReturn the decision using ${TOOL} exactly once, then stop.`
          : ""),
    },
  ];
  event.messages = [
    { role: "user", content: [{ type: "text", text: pending.prompt }] },
  ];
  const definition = event.tools[TOOL];
  event.tools =
    pending.structured && pending.results.length === 0 && definition
      ? { [TOOL]: definition }
      : {};
}

function guardTool(pending: PendingGeneration | undefined, tool: string): void {
  if (pending && (pending.closing || tool !== TOOL)) {
    throw new Error("Operational tools are disabled in reviewer sessions");
  }
}

/** Register the decision tool and the reviewer session guards; undo all on failure. */
export async function registerReviewerHooks(
  ctx: Context,
  sessions: Sessions,
): Promise<() => Promise<void>> {
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  try {
    registrations.push(
      await ctx.tool.transform((editor) =>
        editor.add({
          name: TOOL,
          description:
            "Return exactly one final permission review decision matching the required schema.",
          options: { codemode: false, permission: TOOL },
          input: resultSchema,
          execute: async (
            input: z.infer<typeof resultSchema>,
            execution: ToolContext,
          ) => captureDecision(sessions.get(execution.sessionID), input),
        }),
      ),
    );
    registrations.push(
      await ctx.session.hook("context", (event) =>
        isolateContext(sessions.get(event.sessionID), event),
      ),
    );
    registrations.push(
      await ctx.tool.hook("execute.before", (event) =>
        guardTool(sessions.get(event.sessionID), event.tool),
      ),
    );
    return async (): Promise<void> => {
      await Promise.all(
        registrations.map((registration) => registration.dispose()),
      );
    };
  } catch (error) {
    await Promise.allSettled(
      registrations.map((registration) => registration.dispose()),
    );
    throw error;
  }
}
