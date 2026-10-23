// The Jev request: the state Jev answers on, and the transport, a TypeSafe
// client per provider with its API key, endpoint and retry policy, bounded by
// the reviewer timeout.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { redactSecrets } from "../../../utils/redact.ts";
import { splitModel } from "../../config/services/reviewer-model.ts";
import type { ReviewEnvelope } from "../../context/models/review-envelope.ts";
import { buildEvidenceResult } from "../../context/services/prompt/context.ts";
import {
  DEFAULT_TENANT_POLICY,
  REVIEWER_SYSTEM_PROMPT,
} from "../../context/services/prompt/policy.ts";
import type { SystemOneState } from "./review.ts";
import { SYSTEM_ONE_QUESTIONS } from "./system-one-questions.ts";

export type SystemOneInvoke = (
  state: SystemOneState,
  signal: AbortSignal,
) => Promise<unknown>;

/** The state Jev answers on. Marks the envelope's action evidence incomplete
 *  when the rendered evidence is. */
export function systemOneState(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): SystemOneState {
  const evidence = buildEvidenceResult(envelope, config);
  envelope.actionEvidenceComplete =
    envelope.actionEvidenceComplete !== false &&
    evidence.actionEvidenceComplete;
  return {
    trustedPolicy: {
      reviewer: REVIEWER_SYSTEM_PROMPT,
      tenant: redactSecrets(config.policy ?? DEFAULT_TENANT_POLICY),
    },
    untrustedEvidence: evidence.text,
  };
}

const SYSTEM_ONE_RETRY = {
  maxRetries: 2,
  backoffInitialMs: 400,
  backoffMaxMs: 800,
  httpStatuses: new Set([503]),
  respectRetryAfter: false,
  apiConnectionError: false,
  apiTimeoutError: false,
};

export function createSystemOneInvoker(
  config: ReviewerConfig,
  fetchImpl?: TypeSafeClient["fetch"],
): SystemOneInvoke {
  const { providerID, modelID } = splitModel(config.model);
  const keyName =
    providerID === "opencode"
      ? "OPENCODE_API_KEY"
      : providerID === "commandcode"
        ? "CMD_API_KEY"
        : "TYPESAFE_API_KEY";
  const apiKey = process.env[keyName]?.trim();
  if (!apiKey)
    throw new Error(
      `Missing ${keyName} for System One reviewer ${config.model}`,
    );
  const client = new TypeSafeClient({
    apiKey,
    ...(providerID === "opencode"
      ? { baseURL: "https://opencode.ai/zen" }
      : providerID === "commandcode"
        ? { baseURL: "https://api.commandcode.ai/provider" }
        : {}),
    defaultModel: modelID,
    logLevel: "off",
    timeout: config.timeoutMs,
    retry: SYSTEM_ONE_RETRY,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return async (state: SystemOneState, signal: AbortSignal) => {
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const boundedSignal = AbortSignal.any([signal, deadline]);
    const { data } = await client
      .systemOne(
        { model: modelID, state, questions: SYSTEM_ONE_QUESTIONS },
        { signal: boundedSignal, timeout: config.timeoutMs },
      )
      .withResponse();
    return data;
  };
}
