import { DECISION_SCHEMA_VERSION } from "./decision.ts";

export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "outcome",
    "risk_level",
    "user_authorization",
    "scope_alignment",
    "evidence_completeness",
    "rationale",
    "confidence",
  ],
  properties: {
    version: {
      type: "number",
      enum: [DECISION_SCHEMA_VERSION],
      description: "Structured-decision schema version. Must be exactly 2.",
    },
    outcome: {
      type: "string",
      enum: ["allow", "deny", "escalate"],
      description:
        "allow executes once, deny rejects, escalate leaves the request for a human",
    },
    risk_level: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    user_authorization: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"],
    },
    rationale: {
      type: "string",
      minLength: 3,
      maxLength: 2000,
      description:
        "One concise sentence explaining the main reason for the decision",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    scope_alignment: {
      type: "string",
      enum: ["aligned", "partial", "misaligned", "unknown"],
      description:
        "How well the request aligns with the recovered user or delegated intent: aligned (within scope), partial (tangential), misaligned (outside scope), unknown (insufficient context).",
    },
    evidence_completeness: {
      type: "string",
      enum: ["sufficient", "partial", "insufficient", "unknown"],
      description:
        "Whether the evidence was sufficient to decide: sufficient, partial (some gaps), insufficient (major gaps), unknown.",
    },
    script_analysis: {
      type: "string",
      minLength: 20,
      maxLength: 1500,
      description:
        "Optional factual analysis of a fully supplied verified script. Describe effects and uncertainty, never user authorization or an approval.",
    },
  },
} as const;
