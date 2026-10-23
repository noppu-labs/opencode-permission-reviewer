import type { ReviewDecision } from "../../../kernel/review-decision.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { REVIEWER_SYSTEM_PROMPT } from "../../../modules/context/services/prompt/policy.ts";
import {
  parseDecision,
  parseDecisionFromText,
} from "../../../modules/decision/decision.ts";
import { DECISION_SCHEMA } from "../../../modules/decision/decision-schema.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import {
  extractStructured,
  extractText,
  responseData,
  withTimeout,
} from "../transport.ts";
import type { ClientResponse, OpenCodeClientLike } from "../types.ts";

/** Corrective note for the single text-mode retry; `promptForDecision`
 *  (v1-review-turn.ts) says why the retry is safe. */
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
 * Returns the raw response so the elapsed time is recorded before
 * `parseReviewerResponse` validates it. The role and safety rules go in the
 * system prompt so they outrank the untrusted evidence; the per-request part
 * and any retry note go in as user content.
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
