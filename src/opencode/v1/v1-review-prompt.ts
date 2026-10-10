import type { ReviewAttempt } from "../../core/review-attempt.ts";
import { parseDecision, parseDecisionFromText } from "../../decision.ts";
import { DECISION_SCHEMA } from "../../decision-schema.ts";
import { REVIEWER_SYSTEM_PROMPT } from "../../policy.ts";
import type { ReviewDecision, ReviewerConfig } from "../../types.ts";
import {
  extractStructured,
  extractText,
  responseData,
  withTimeout,
} from "../transport.ts";
import type { ClientResponse, OpenCodeClientLike } from "../types.ts";

/**
 * Corrective instruction appended to a text-mode parse-failure retry. Text mode
 * has no host-side schema enforcement, so instead of loosening the strict
 * fail-closed extractor (which could auto-approve a draft decision the model
 * later reversed in prose) the coordinator re-prompts once with this note and
 * parses the retry with the same extractor.
 */
export const TEXT_MODE_RETRY_NOTE =
  "Your previous response could not be parsed as a decision. Respond again with " +
  "exactly one JSON object conforming to the schema and nothing else - no prose, " +
  "no Markdown code fences, no commentary, and no copy of the schema.";

/** One reviewer prompt's session, model, tool switches and evidence prompt. */
export interface ReviewerPrompt {
  sessionID: string;
  directory: string;
  model: { providerID: string; modelID: string };
  tools: Record<string, boolean>;
  prompt: string;
}

/**
 * Deny every named tool AND everything else via the wildcard: the host
 * turns each entry into a session permission rule, and session rules
 * take precedence over agent-config allows. A plain name list is not
 * enough - MCP tools (registered outside the tool registry) and the MCP
 * resource tools would keep executing under host-configured allows. The
 * wildcard key covers unknown operational tools, including MCP tools.
 * The host filters StructuredOutput through the same permission rules.
 */
export function reviewerTools(
  toolIDs: string[],
  outputFormat: ReviewerConfig["outputFormat"],
): Record<string, boolean> {
  const tools: Record<string, boolean> = { "*": false };
  for (const id of toolIDs) tools[id] = false;
  if (outputFormat === "json_schema") {
    delete tools.StructuredOutput;
    tools.StructuredOutput = true;
  }
  return tools;
}

/** Parse a reviewer response in the configured format; throws on a transport error. */
export function parseReviewerResponse(
  response: ClientResponse<Record<string, unknown>>,
  outputFormat: ReviewerConfig["outputFormat"],
): ReviewDecision | undefined {
  const data = responseData(response, "session.prompt");
  return outputFormat === "text"
    ? parseDecisionFromText(extractText(data) ?? "")
    : parseDecision(extractStructured(data));
}

/**
 * Issue a single reviewer prompt in the review session and return the raw
 * response plus its elapsed time. `responseData` is applied by the caller so
 * the caller can record the elapsed time even when the response is invalid.
 * The role/safety rules live in the system prompt so they carry system-level
 * priority over the untrusted evidence; the per-request part (and an optional
 * corrective retry note) is appended as user content.
 */
export async function promptReviewer(
  client: OpenCodeClientLike,
  config: ReviewerConfig,
  request: ReviewerPrompt,
  attempt: ReviewAttempt,
  retryNote?: string,
): Promise<{
  response: ClientResponse<Record<string, unknown>>;
  ms: number;
}> {
  const start = performance.now();
  attempt.signal.throwIfAborted();
  const response = await attempt.wait(
    withTimeout(
      client.session.prompt({
        signal: attempt.signal,
        path: { id: request.sessionID },
        query: { directory: request.directory },
        body: {
          model: request.model,
          variant: config.variant,
          tools: request.tools,
          system: REVIEWER_SYSTEM_PROMPT,
          format:
            config.outputFormat === "text"
              ? { type: "text" }
              : {
                  type: "json_schema",
                  schema: DECISION_SCHEMA,
                  retryCount: 2,
                },
          parts:
            retryNote === undefined
              ? [{ type: "text", text: request.prompt }]
              : [
                  { type: "text", text: request.prompt },
                  { type: "text", text: retryNote },
                ],
        },
      }),
      config.timeoutMs,
    ),
  );
  return { response, ms: performance.now() - start };
}
