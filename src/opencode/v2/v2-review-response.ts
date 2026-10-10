import type { OpenCodeClient } from "@opencode/client";
import { parseDecisionFromText } from "../../decision.ts";
import type { ReviewDecision } from "../../types.ts";
import { type PendingGeneration, TOOL } from "./v2-review-pending.ts";

type ContextMessage = Awaited<
  ReturnType<OpenCodeClient["session"]["context"]>
>[number];
type AssistantMessage = Extract<ContextMessage, { type: "assistant" }>;

/**
 * Whether a captured decision is ambiguous: more than one, or one whose reply
 * is not the admitted prompt's, or whose tool calls are not host schema
 * retries (each its own message, at most three, every earlier one a failed
 * call to the decision tool) ending in a completed decision call.
 */
function isAmbiguous(
  results: number,
  admitted: boolean,
  response: AssistantMessage[],
): boolean {
  const toolMessages = response
    .map((message) => message.content.filter((part) => part.type === "tool"))
    .filter((parts) => parts.length > 0);
  const toolParts = toolMessages.flat();
  const finalTool = toolParts.at(-1);
  const boundedSchemaRetries =
    toolMessages.every((parts) => parts.length === 1) &&
    toolParts.length <= 3 &&
    toolParts
      .slice(0, -1)
      .every((part) => part.name === TOOL && part.state.status === "error");
  return (
    results > 1 ||
    (results === 1 &&
      (!admitted ||
        !boundedSchemaRetries ||
        finalTool?.name !== TOOL ||
        finalTool?.state.status !== "completed"))
  );
}

function responseText(response: AssistantMessage[]): string {
  return response
    .flatMap((message) =>
      message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text),
    )
    .join("\n");
}

/** Read the reply to the admitted prompt; the session is exclusively this attempt's. */
export function readReviewerResponse(
  messages: ContextMessage[],
  admittedID: string,
  pending: PendingGeneration,
): { ambiguous: boolean; parsed: ReviewDecision | undefined } {
  const userIndex = messages.findIndex((message) => message.id === admittedID);
  const response = messages
    .slice(userIndex < 0 ? messages.length : userIndex + 1)
    .filter((message) => message.type === "assistant");
  const ambiguous = isAmbiguous(
    pending.results.length,
    userIndex >= 0,
    response,
  );
  const parsed = pending.structured
    ? pending.results.length === 1 && !ambiguous
      ? pending.results[0]
      : undefined
    : parseDecisionFromText(responseText(response));
  return { ambiguous, parsed };
}
