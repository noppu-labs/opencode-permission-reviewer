// The Jev request: the state Jev answers on, and the transport, a TypeSafe
// client per provider with its API key, endpoint and retry policy, bounded by
// the reviewer timeout.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { redactSecrets } from "../../../utils/redact.ts";
import { systemOneProviderFor } from "../../config/services/reviewer-model.ts";
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
  const resolved = systemOneProviderFor(config.model);
  if (!resolved)
    throw new Error(`Unsupported System One reviewer model ${config.model}`);
  const { provider, modelID } = resolved;
  const incompatible = provider.incompatibleReason?.(modelID);
  if (incompatible) throw new Error(incompatible);
  const apiKey = process.env[provider.keyEnv]?.trim();
  if (!apiKey)
    throw new Error(
      `Missing ${provider.keyEnv} for System One reviewer ${config.model}`,
    );
  if (provider.keyShape && !provider.keyShape.pattern.test(apiKey))
    throw new Error(provider.keyShape.message);
  const client = new TypeSafeClient({
    apiKey,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
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
