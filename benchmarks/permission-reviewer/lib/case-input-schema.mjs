import { assert, sha256 } from "./util.mjs";
export const INPUT_KEYS = new Set([
  "directory",
  "worktree",
  "request",
  "messages",
  "enrichment",
  "actorProfile",
  "actorName",
  "delegatedTask",
  "directUserIntent",
  "delegatedSession",
  "actionPurpose",
  "config",
  "policyAppend",
  "askDecisions",
  "preflightDenial",
  "actionEvidenceComplete",
]);
const CONFIG_KEYS = new Set([
  "maxContextChars",
  "maxPartChars",
  "maxEnrichmentChars",
  "maxIntentChars",
  "transcriptMessages",
  "intentMessages",
  "historyMessages",
  "confidenceThreshold",
  "systemOneConfidenceThreshold",
  "systemOneReasoningThreshold",
  "enforcementMode",
  "escalationMode",
  "actorProfiles",
  "riskPolicy",
  "repositoryTrust",
  "policyRules",
  "configDegraded",
]);
function validateRequest(id, r) {
  assert(
    r &&
      typeof r.permission === "string" &&
      Array.isArray(r.patterns) &&
      r.patterns.every((x) => typeof x === "string") &&
      Array.isArray(r.always) &&
      r.metadata &&
      typeof r.metadata === "object",
    `${id}: request schema`,
  );
  assert(
    typeof r.id === "string" && typeof r.sessionID === "string",
    `${id}: request identities`,
  );
}
function validateConfig(id, config) {
  for (const [key, val] of Object.entries(config ?? {})) {
    assert(CONFIG_KEYS.has(key), `${id}: unsupported case config ${key}`);
    if (key.startsWith("max") || key.endsWith("Messages"))
      assert(
        Number.isInteger(val) && val >= 1,
        `${id}: invalid config budget ${key}`,
      );
  }
}
export function validateInput(c, inputs) {
  const input = c.input;
  assert(input && typeof input === "object", `${c.id}: input missing`);
  for (const key of Object.keys(input))
    assert(
      INPUT_KEYS.has(key),
      `${c.id}: unrecognized input key ${key}; do not mix labels with evidence`,
    );
  const r = input.request;
  validateRequest(c.id, r);
  assert(
    Array.isArray(input.messages) &&
      input.messages.every((m) => m.info && Array.isArray(m.parts)),
    `${c.id}: messages`,
  );
  assert(
    typeof input.directory === "string" && typeof input.worktree === "string",
    `${c.id}: paths`,
  );
  validateConfig(c.id, input.config);
  const fingerprint = sha256({
    ...input,
    request: { ...r, id: "", sessionID: "", tool: undefined },
  });
  assert(!inputs.has(fingerprint), `${c.id}: exact duplicate model input`);
  inputs.add(fingerprint);
}
