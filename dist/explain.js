#!/usr/bin/env bun

// src/cli/explain.ts
import { parseArgs as parseArgs2 } from "util";
import { createHash as createHash6 } from "crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { mkdir as mkdir2, open as open2 } from "fs/promises";
import { dirname as dirname3, join as join4 } from "path";

// src/config.ts
var DEFAULT_RISK_POLICY = {
  allow: {
    low: ["high", "medium", "low", "unknown"],
    medium: ["high", "medium", "low"],
    high: ["high", "medium"],
    critical: []
  },
  minimumConfidence: 0.7,
  onInvalidDecision: "manual",
  onReviewerFailure: "manual"
};
var DEFAULT_CONFIG = {
  model: "openai/gpt-6-luna",
  variant: "medium",
  outputFormat: "json_schema",
  timeoutMs: 12e4,
  maxContextChars: 32e3,
  maxPartChars: 8e3,
  maxEnrichmentChars: 24e3,
  maxIntentChars: 8e3,
  transcriptMessages: 12,
  intentMessages: 8,
  historyMessages: 200,
  confidenceThreshold: 0.7,
  systemOneConfidenceThreshold: 0.4,
  systemOneReasoningThreshold: 0.38,
  retainReviewSessions: false,
  audit: true,
  debug: false,
  enforcementMode: "observe",
  escalationMode: "manual",
  maxSessionDepth: 8,
  maxParentSessions: 8,
  actorProfiles: {},
  riskPolicy: DEFAULT_RISK_POLICY,
  repositoryTrust: "unknown",
  policyRules: [],
  askDecisions: true
};
function boundedInteger(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function boundedNumber(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
var ACTOR_PROFILES = /* @__PURE__ */ new Set([
  "read-only",
  "validation",
  "workspace",
  "operator",
  "reviewer",
  "unknown"
]);
var ACTION_CLASS_MEMBERS = {
  "read-only": true,
  "workspace-write": true,
  "temporary-write": true,
  "external-write": true,
  destruction: true,
  "code-execution": true,
  "package-management": true,
  "git-mutation": true,
  network: true,
  "remote-operation": true,
  "service-management": true,
  persistence: true,
  "privilege-escalation": true,
  unknown: true
};
var VALID_ACTION_CLASS = new Set(Object.keys(ACTION_CLASS_MEMBERS));
var VALID_REPOSITORY_TRUST = /* @__PURE__ */ new Set(["trusted", "untrusted", "unknown"]);
function resolveActorProfiles(value) {
  if (typeof value !== "object" || value === null) return {};
  const out = {};
  for (const [name, profile] of Object.entries(value)) {
    if (typeof profile === "string" && ACTOR_PROFILES.has(profile)) {
      out[name] = profile;
    }
  }
  return out;
}
var VALID_AUTH = /* @__PURE__ */ new Set(["high", "medium", "low", "unknown"]);
function resolveRiskPolicy(value) {
  if (typeof value !== "object" || value === null)
    return { ...DEFAULT_RISK_POLICY, allow: { ...DEFAULT_RISK_POLICY.allow } };
  const src = value;
  const allowSrc = typeof src.allow === "object" && src.allow !== null ? src.allow : {};
  const merged = {
    allow: { ...DEFAULT_RISK_POLICY.allow },
    minimumConfidence: DEFAULT_RISK_POLICY.minimumConfidence,
    // Prefer an explicit deny from either the field or a pre-clamped trusted
    // baseline (loader may have already hardened the knob).
    onInvalidDecision: src.onInvalidDecision === "deny" ? "deny" : DEFAULT_RISK_POLICY.onInvalidDecision,
    onReviewerFailure: src.onReviewerFailure === "deny" ? "deny" : DEFAULT_RISK_POLICY.onReviewerFailure
  };
  for (const risk of ["low", "medium", "high", "critical"]) {
    const cell = allowSrc[risk];
    if (!Array.isArray(cell)) continue;
    const auths = cell.filter(
      (a) => typeof a === "string" && VALID_AUTH.has(a)
    );
    merged.allow[risk] = auths;
  }
  if (typeof src.minimumConfidence === "number" && Number.isFinite(src.minimumConfidence)) {
    merged.minimumConfidence = Math.min(1, Math.max(0.5, src.minimumConfidence));
  }
  return merged;
}
function resolveEscalationMode(value) {
  return value === "deny" ? "deny" : "manual";
}
function resolveRepositoryTrust(value) {
  if (value === "trusted") return "trusted";
  if (value === "untrusted") return "untrusted";
  return "unknown";
}
var VALID_EFFECTS = /* @__PURE__ */ new Set(["review", "manual", "deny", "allow"]);
var VALID_SOURCES = /* @__PURE__ */ new Set(["builtin", "global", "project", "inline"]);
function parsePolicyRule(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.source !== "string" || !VALID_SOURCES.has(r.source)) return null;
  if (typeof r.effect !== "string" || !VALID_EFFECTS.has(r.effect)) return null;
  if (typeof r.reason !== "string" || r.reason.length === 0) return null;
  if (r.when !== void 0) {
    if (typeof r.when !== "object" || r.when === null) return null;
    const when = validateCondition(r.when);
    if (when === null) return null;
    return {
      id: r.id,
      source: r.source,
      when,
      effect: r.effect,
      reason: r.reason
    };
  }
  return {
    id: r.id,
    source: r.source,
    effect: r.effect,
    reason: r.reason
  };
}
function resolvePolicyRules(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const rule = parsePolicyRule(raw);
    if (rule !== null) out.push(rule);
  }
  return out;
}
function countInvalidPolicyRules(value) {
  if (value === void 0) return 0;
  if (!Array.isArray(value)) return 1;
  return value.filter((raw) => parsePolicyRule(raw) === null).length;
}
var CONDITION_LIST_KEYS = ["actionClass", "actorProfile", "repositoryTrust"];
var CONDITION_FLAG_KEYS = [
  "writesWorkspace",
  "writesExternal",
  "writesTemporary",
  "deletion",
  "executesCode",
  "createsAdHocCode",
  "packageManagement",
  "gitMutation",
  "networkObserved",
  "credentialRead",
  "privilegeEscalation",
  "remoteEnabled",
  "persistence"
];
function validateCondition(value) {
  const knownKeys = /* @__PURE__ */ new Set(["always", ...CONDITION_LIST_KEYS, ...CONDITION_FLAG_KEYS]);
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) return null;
  }
  if (value.always !== void 0) {
    if (value.always !== true || Object.keys(value).length !== 1) return null;
    return { always: true };
  }
  const out = {};
  if (value.actionClass !== void 0) {
    if (!isClosedSetMemberArray(value.actionClass, VALID_ACTION_CLASS)) return null;
    out.actionClass = value.actionClass;
  }
  if (value.actorProfile !== void 0) {
    if (!isClosedSetMemberArray(value.actorProfile, ACTOR_PROFILES))
      return null;
    out.actorProfile = value.actorProfile;
  }
  if (value.repositoryTrust !== void 0) {
    if (!isClosedSetMemberArray(value.repositoryTrust, VALID_REPOSITORY_TRUST)) return null;
    out.repositoryTrust = value.repositoryTrust;
  }
  for (const flag of CONDITION_FLAG_KEYS) {
    if (value[flag] !== void 0) {
      if (typeof value[flag] !== "boolean") return null;
      if (value[flag] === false) return null;
      out[flag] = value[flag];
    }
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
function isClosedSetMemberArray(value, valid) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && valid.has(v));
}
function resolveConfig(options) {
  const source = options ?? {};
  const model = typeof source.model === "string" && source.model.includes("/") ? source.model : DEFAULT_CONFIG.model;
  const variant = typeof source.variant === "string" && source.variant.length > 0 ? source.variant : DEFAULT_CONFIG.variant;
  const outputFormat = source.outputFormat === "text" ? "text" : "json_schema";
  const escalationReviewer = resolveEscalationReviewer(source.escalationReviewer);
  const policy = typeof source.policy === "string" && source.policy.trim().length > 0 ? source.policy.trim() : void 0;
  const auditPath = typeof source.auditPath === "string" && source.auditPath.trim().length > 0 ? source.auditPath.trim() : void 0;
  return {
    model,
    variant,
    outputFormat,
    ...escalationReviewer === void 0 ? {} : { escalationReviewer },
    timeoutMs: boundedInteger(source.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5e3, 6e5),
    ...source.reviewBudgetMs === void 0 ? {} : { reviewBudgetMs: boundedInteger(source.reviewBudgetMs, 18e4, 5e3, 9e5) },
    maxContextChars: boundedInteger(
      source.maxContextChars,
      DEFAULT_CONFIG.maxContextChars,
      4e3,
      2e5
    ),
    maxPartChars: boundedInteger(source.maxPartChars, DEFAULT_CONFIG.maxPartChars, 500, 5e4),
    maxEnrichmentChars: boundedInteger(
      source.maxEnrichmentChars,
      DEFAULT_CONFIG.maxEnrichmentChars,
      1e3,
      1e5
    ),
    maxIntentChars: boundedInteger(
      source.maxIntentChars,
      DEFAULT_CONFIG.maxIntentChars,
      1e3,
      5e4
    ),
    transcriptMessages: boundedInteger(
      source.transcriptMessages,
      DEFAULT_CONFIG.transcriptMessages,
      1,
      100
    ),
    intentMessages: boundedInteger(source.intentMessages, DEFAULT_CONFIG.intentMessages, 1, 50),
    historyMessages: boundedInteger(
      source.historyMessages,
      DEFAULT_CONFIG.historyMessages,
      20,
      500
    ),
    confidenceThreshold: boundedNumber(
      source.confidenceThreshold,
      DEFAULT_CONFIG.confidenceThreshold,
      0.5,
      1
    ),
    systemOneConfidenceThreshold: boundedNumber(
      source.systemOneConfidenceThreshold,
      DEFAULT_CONFIG.systemOneConfidenceThreshold,
      0.3,
      1
    ),
    systemOneReasoningThreshold: boundedNumber(
      source.systemOneReasoningThreshold,
      DEFAULT_CONFIG.systemOneReasoningThreshold,
      0,
      1
    ),
    retainReviewSessions: typeof source.retainReviewSessions === "boolean" ? source.retainReviewSessions : DEFAULT_CONFIG.retainReviewSessions,
    audit: typeof source.audit === "boolean" ? source.audit : DEFAULT_CONFIG.audit,
    ...auditPath === void 0 ? {} : { auditPath },
    ...policy === void 0 ? {} : { policy },
    debug: typeof source.debug === "boolean" ? source.debug : DEFAULT_CONFIG.debug,
    enforcementMode: source.enforcementMode === "enforce" ? "enforce" : DEFAULT_CONFIG.enforcementMode,
    escalationMode: resolveEscalationMode(source.escalationMode),
    maxSessionDepth: boundedInteger(source.maxSessionDepth, DEFAULT_CONFIG.maxSessionDepth, 1, 32),
    maxParentSessions: boundedInteger(
      source.maxParentSessions,
      DEFAULT_CONFIG.maxParentSessions,
      0,
      32
    ),
    actorProfiles: resolveActorProfiles(source.actorProfiles),
    riskPolicy: resolveRiskPolicy(source.riskPolicy),
    repositoryTrust: resolveRepositoryTrust(source.repositoryTrust),
    policyRules: resolvePolicyRules(source.policyRules),
    askDecisions: typeof source.askDecisions === "boolean" ? source.askDecisions : DEFAULT_CONFIG.askDecisions,
    ...isStringArray(source.configDegraded) && source.configDegraded.length > 0 ? { configDegraded: source.configDegraded } : {}
  };
}
function resolveEscalationReviewer(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const source = value;
  if (typeof source.model !== "string" || !source.model.includes("/") || isSystemOneReviewerModel(source.model))
    return;
  return {
    model: source.model,
    variant: typeof source.variant === "string" && source.variant.length > 0 ? source.variant : DEFAULT_CONFIG.variant,
    outputFormat: source.outputFormat === "text" ? "text" : "json_schema",
    timeoutMs: boundedInteger(source.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5e3, 6e5)
  };
}
function isValidEscalationReviewer(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value;
  if (typeof source.model !== "string" || !source.model.includes("/") || isSystemOneReviewerModel(source.model))
    return false;
  if (source.variant !== void 0 && (typeof source.variant !== "string" || !source.variant))
    return false;
  if (source.outputFormat !== void 0 && source.outputFormat !== "text" && source.outputFormat !== "json_schema")
    return false;
  if (source.timeoutMs !== void 0 && (typeof source.timeoutMs !== "number" || !Number.isInteger(source.timeoutMs)))
    return false;
  return true;
}
function splitModel(model) {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`Invalid reviewer model "${model}"; expected provider/model`);
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1)
  };
}
function isSystemOneReviewerModel(model) {
  let parsed;
  try {
    parsed = splitModel(model);
  } catch {
    return false;
  }
  return (parsed.providerID === "opencode" || parsed.providerID === "typesafe-ai") && /^jev(?:-|$)/.test(parsed.modelID) || parsed.providerID === "commandcode" && parsed.modelID === "typesafe/jev";
}

// src/config/loader.ts
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// src/config/jsonc.ts
function parseJsoncStrict(text) {
  const stripped = stripCommentsAndTrailingCommas(text);
  const parsed = JSON.parse(stripped);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("top-level value is not a JSON object");
  }
  return parsed;
}
function stripCommentsAndTrailingCommas(input) {
  let out = "";
  let i = 0;
  const len = input.length;
  let lastReal = "";
  const append = (ch) => {
    out += ch;
    if (ch !== " " && ch !== "	" && ch !== "\n" && ch !== "\r") lastReal = ch;
  };
  while (i < len) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === '"') {
      append(ch);
      i += 1;
      while (i < len) {
        const c = input[i];
        append(c);
        if (c === "\\" && i + 1 < len) {
          append(input[i + 1]);
          i += 2;
          continue;
        }
        i += 1;
        if (c === '"') break;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if ((ch === "}" || ch === "]") && lastReal === ",") {
      let j = out.length - 1;
      while (j >= 0 && out[j] !== ",") j -= 1;
      if (j >= 0) out = out.slice(0, j);
      lastReal = "";
    }
    append(ch);
    i += 1;
  }
  return out;
}

// src/config/loader.ts
var O_RDONLY = typeof fsConstants.O_RDONLY === "number" ? fsConstants.O_RDONLY : 0;
var O_NOFOLLOW = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
var O_NONBLOCK = typeof fsConstants.O_NONBLOCK === "number" ? fsConstants.O_NONBLOCK : 0;
var CONFIG_READ_CAP_BYTES = 1024 * 1024;
function readConfigLayer(path) {
  const read = readLayerText(path);
  if (!("text" in read)) return read;
  try {
    return { raw: parseJsoncStrict(read.text), status: "ok" };
  } catch (error) {
    return {
      raw: {},
      status: "malformed",
      warning: `permission-reviewer config at ${path} is malformed and was ignored (${error instanceof Error ? error.message : String(error)})`
    };
  }
}
function readLayerText(path) {
  const readError = (warning) => ({ raw: {}, status: "read-error", warning });
  let fd;
  try {
    try {
      fd = openSync(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT") return { raw: {}, status: "missing" };
      return readError(
        `permission-reviewer config at ${path} exists but could not be read (${code ?? "unknown error"}); the layer was ignored`
      );
    }
    const info = fstatSync(fd);
    if (!info.isFile()) {
      return readError(
        `permission-reviewer config at ${path} is not a regular file and was ignored`
      );
    }
    if (info.size > CONFIG_READ_CAP_BYTES) {
      return readError(
        `permission-reviewer config at ${path} exceeds the size limit (${CONFIG_READ_CAP_BYTES} bytes) and was ignored`
      );
    }
    const length = info.size;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = readSync(fd, buffer, read, length - read, read);
      if (count === 0) break;
      read += count;
    }
    const text = (read < length ? buffer.subarray(0, read) : buffer).toString("utf8");
    return { status: "ok", text };
  } catch (error) {
    const code = error.code;
    return readError(
      `permission-reviewer config at ${path} exists but could not be read (${code ?? "unknown error"}); the layer was ignored`
    );
  } finally {
    if (fd !== void 0) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
}
var globalConfigPathOverride;
function globalConfigPath() {
  return globalConfigPathOverride ?? join(homedir(), ".config", "opencode", "permission-reviewer.jsonc");
}
function projectConfigPath(directory) {
  return join(directory, ".opencode", "permission-reviewer.jsonc");
}
var TRUST_BOUNDARY_KEYS = /* @__PURE__ */ new Set([
  "confidenceThreshold",
  "systemOneConfidenceThreshold",
  "systemOneReasoningThreshold",
  "audit",
  "auditPath",
  "model",
  "escalationReviewer",
  "policy",
  "repositoryTrust",
  "actorProfiles",
  "enforcementMode",
  "riskPolicy",
  "escalationMode",
  "policyRules",
  "variant",
  "outputFormat",
  "retainReviewSessions",
  "timeoutMs",
  "reviewBudgetMs",
  "maxContextChars",
  "maxPartChars",
  "maxEnrichmentChars",
  "maxIntentChars",
  "transcriptMessages",
  "intentMessages",
  "historyMessages",
  "maxSessionDepth",
  "maxParentSessions",
  "askDecisions",
  "debug"
]);
var TRUSTED_ONLY_RESOURCE_KEYS = [
  "timeoutMs",
  "reviewBudgetMs",
  "maxContextChars",
  "maxPartChars",
  "maxEnrichmentChars",
  "maxIntentChars",
  "transcriptMessages",
  "intentMessages",
  "historyMessages",
  "maxSessionDepth",
  "maxParentSessions"
];
function loadResolvedConfig(inlineOptions, directory, inlineTrust = "trusted") {
  const globalLayer = readConfigLayer(globalConfigPath());
  const projectLayer = directory !== void 0 ? readConfigLayer(projectConfigPath(directory)) : { raw: {}, status: "missing" };
  for (const layer of [globalLayer, projectLayer]) {
    if (layer.warning !== void 0) console.warn(layer.warning);
  }
  const degraded = [];
  if (globalLayer.status === "malformed") {
    degraded.push("global config file is malformed and was ignored");
  } else if (globalLayer.status === "read-error") {
    degraded.push("global config file exists but could not be read");
  } else if (globalLayer.status === "ok") {
    if (globalLayer.raw.escalationReviewer !== void 0 && !isValidEscalationReviewer(globalLayer.raw.escalationReviewer)) {
      degraded.push("global config escalationReviewer is invalid and was ignored");
      console.warn(
        "permission-reviewer: global config escalationReviewer is invalid and was ignored; automatic approval stays disabled until it is fixed"
      );
    }
    const invalidRules = countInvalidPolicyRules(globalLayer.raw.policyRules);
    if (invalidRules > 0) {
      degraded.push(
        `${invalidRules} policy rule(s) from the global config were dropped by validation`
      );
      console.warn(
        `permission-reviewer: ${invalidRules} policy rule(s) in the global config are invalid and were dropped; automatic approval stays disabled until they are fixed`
      );
    }
    const globalEnforcement = globalLayer.raw.enforcementMode;
    if (globalEnforcement !== void 0 && globalEnforcement !== "enforce" && globalEnforcement !== "observe") {
      degraded.push(
        `global config enforcementMode ${JSON.stringify(globalEnforcement)} is invalid and was ignored`
      );
      console.warn(
        `permission-reviewer: global config enforcementMode ${JSON.stringify(globalEnforcement)} is invalid and was ignored; automatic approval stays disabled until it is fixed`
      );
    }
    const globalEscalation = globalLayer.raw.escalationMode;
    if (globalEscalation !== void 0 && globalEscalation !== "manual" && globalEscalation !== "deny") {
      degraded.push(
        `global config escalationMode ${JSON.stringify(globalEscalation)} is invalid and was ignored`
      );
      console.warn(
        `permission-reviewer: global config escalationMode ${JSON.stringify(globalEscalation)} is invalid and was ignored; automatic approval stays disabled until it is fixed`
      );
    }
  }
  const invalidInlineRules = inlineTrust === "trusted" ? countInvalidPolicyRules(inlineOptions?.policyRules) : 0;
  if (invalidInlineRules > 0) {
    degraded.push(
      `${invalidInlineRules} policy rule(s) from inline config were dropped by validation`
    );
  }
  if (inlineTrust === "trusted" && inlineOptions !== void 0) {
    if (inlineOptions.escalationReviewer !== void 0 && !isValidEscalationReviewer(inlineOptions.escalationReviewer)) {
      degraded.push("inline config escalationReviewer is invalid and was ignored");
    }
    const inlineEnforcement = inlineOptions.enforcementMode;
    if (inlineEnforcement !== void 0 && inlineEnforcement !== "enforce" && inlineEnforcement !== "observe") {
      degraded.push(
        `inline config enforcementMode ${JSON.stringify(inlineEnforcement)} is invalid and was ignored`
      );
    }
    const inlineEscalation = inlineOptions.escalationMode;
    if (inlineEscalation !== void 0 && inlineEscalation !== "manual" && inlineEscalation !== "deny") {
      degraded.push(
        `inline config escalationMode ${JSON.stringify(inlineEscalation)} is invalid and was ignored`
      );
    }
  }
  const invalidProjectRules = countInvalidPolicyRules(projectLayer.raw.policyRules);
  if (invalidProjectRules > 0) {
    console.warn(
      `permission-reviewer: ${invalidProjectRules} policy rule(s) in the project config are invalid and were dropped`
    );
  }
  const trusted = {
    ...DEFAULT_CONFIG,
    ...globalLayer.raw,
    ...inlineTrust === "trusted" ? inlineOptions ?? {} : {}
  };
  let merged = mergeWithTrustBoundary(trusted, projectLayer.raw);
  if (inlineTrust !== "trusted") {
    const restrictions = Object.fromEntries(
      Object.entries(inlineOptions ?? {}).filter(([key]) => TRUST_BOUNDARY_KEYS.has(key))
    );
    merged = mergeWithTrustBoundary(merged, restrictions);
  }
  const out = { ...merged };
  for (const [key, value] of Object.entries(inlineOptions ?? {})) {
    if (inlineTrust === "trusted" && !TRUST_BOUNDARY_KEYS.has(key)) out[key] = value;
  }
  if (degraded.length > 0) out.configDegraded = degraded;
  return resolveConfig(out);
}
function hasKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeWithTrustBoundary(trusted, project) {
  const clamped = { ...project };
  delete clamped.configDegraded;
  for (const key of [
    "confidenceThreshold",
    "systemOneConfidenceThreshold",
    "systemOneReasoningThreshold"
  ]) {
    if (hasKey(clamped, key)) {
      if (typeof clamped[key] !== "number" || !Number.isFinite(clamped[key])) {
        delete clamped[key];
      } else {
        const floor = typeof trusted[key] === "number" ? trusted[key] : DEFAULT_CONFIG[key];
        if (clamped[key] < floor) clamped[key] = floor;
      }
    }
  }
  for (const key of TRUSTED_ONLY_RESOURCE_KEYS) {
    delete clamped[key];
  }
  if (clamped.audit === false && trusted.audit !== false) {
    delete clamped.audit;
  }
  delete clamped.askDecisions;
  delete clamped.auditPath;
  delete clamped.model;
  delete clamped.escalationReviewer;
  delete clamped.policy;
  delete clamped.variant;
  delete clamped.outputFormat;
  delete clamped.retainReviewSessions;
  delete clamped.debug;
  if (clamped.repositoryTrust !== "untrusted") {
    delete clamped.repositoryTrust;
  }
  delete clamped.actorProfiles;
  if (clamped.enforcementMode !== void 0) {
    if (clamped.enforcementMode === "enforce" || trusted.enforcementMode === "enforce") {
      delete clamped.enforcementMode;
    }
  }
  if (hasKey(clamped, "riskPolicy")) {
    if (isPlainObject(clamped.riskPolicy)) {
      const trustedPolicy = isPlainObject(trusted.riskPolicy) ? trusted.riskPolicy : DEFAULT_RISK_POLICY;
      clamped.riskPolicy = clampRiskPolicy(clamped.riskPolicy, trustedPolicy);
    } else {
      delete clamped.riskPolicy;
    }
  }
  if (clamped.escalationMode !== void 0) {
    if (clamped.escalationMode !== "manual" && clamped.escalationMode !== "deny") {
      delete clamped.escalationMode;
    } else if (clamped.escalationMode === "manual" && trusted.escalationMode === "deny") {
      delete clamped.escalationMode;
    }
  }
  if (Array.isArray(clamped.policyRules)) {
    const projectRules = clamped.policyRules.map((rule) => ({
      ...rule,
      source: "project"
    }));
    const trustedRules = Array.isArray(trusted.policyRules) ? trusted.policyRules : [];
    clamped.policyRules = [...trustedRules, ...projectRules];
  } else if (Array.isArray(trusted.policyRules)) {
    clamped.policyRules = trusted.policyRules;
  }
  return { ...trusted, ...clamped };
}
function clampRiskPolicy(project, trusted) {
  const projectAllow = typeof project.allow === "object" && project.allow !== null ? project.allow : void 0;
  const trustedAllow = typeof trusted.allow === "object" && trusted.allow !== null ? trusted.allow : {};
  const clampedAllow = {};
  for (const risk of ["low", "medium", "high", "critical"]) {
    const trustedCell = Array.isArray(trustedAllow[risk]) ? trustedAllow[risk] : [];
    if (projectAllow === void 0) {
      clampedAllow[risk] = trustedCell;
      continue;
    }
    const projectCell = Array.isArray(projectAllow[risk]) ? projectAllow[risk] : [];
    clampedAllow[risk] = trustedCell.filter((auth) => projectCell.includes(auth));
  }
  const out = {
    ...trusted,
    allow: clampedAllow
  };
  if (project.onInvalidDecision === "deny" || trusted.onInvalidDecision === "deny") {
    out.onInvalidDecision = "deny";
  } else if (project.onInvalidDecision === "manual" || project.onInvalidDecision === void 0) {
    out.onInvalidDecision = trusted.onInvalidDecision ?? "manual";
  }
  if (project.onReviewerFailure === "deny" || trusted.onReviewerFailure === "deny") {
    out.onReviewerFailure = "deny";
  } else if (project.onReviewerFailure === "manual" || project.onReviewerFailure === void 0) {
    out.onReviewerFailure = trusted.onReviewerFailure ?? "manual";
  }
  const trustedMin = typeof trusted.minimumConfidence === "number" && Number.isFinite(trusted.minimumConfidence) ? trusted.minimumConfidence : DEFAULT_RISK_POLICY.minimumConfidence;
  if (typeof project.minimumConfidence === "number" && Number.isFinite(project.minimumConfidence)) {
    out.minimumConfidence = Math.max(trustedMin, project.minimumConfidence);
  } else {
    out.minimumConfidence = trustedMin;
  }
  return out;
}

// src/shell-lexer.ts
var SEPARATORS = /* @__PURE__ */ new Set([";", "|", "&", "\n", "\r", "(", ")"]);
var WHITESPACE = /* @__PURE__ */ new Set([" ", "	"]);
var TRANSPARENT_WRAPPERS = /* @__PURE__ */ new Set([
  "sudo",
  "doas",
  "pkexec",
  "env",
  "command",
  "nice",
  "nohup",
  "time",
  "stdbuf",
  "ionice",
  "fakeroot",
  "setsid",
  "setpriv",
  "unshare",
  "run0",
  "systemd-run",
  "strace",
  "ltrace",
  "watch",
  "xargs",
  "timeout",
  "exec"
]);
var VALUE_OPTIONS = {
  sudo: /* @__PURE__ */ new Set([
    "-u",
    "--user",
    "-g",
    "--group",
    "-C",
    "-p",
    "--prompt",
    "-R",
    "-T",
    "-U",
    "-D",
    "--chdir",
    "-r",
    "-t"
  ]),
  doas: /* @__PURE__ */ new Set(["-u", "--user", "-a"]),
  pkexec: /* @__PURE__ */ new Set(["--user", "--session"]),
  env: /* @__PURE__ */ new Set(["-u", "--unset", "-S", "--split-string", "-C", "--chdir"]),
  nice: /* @__PURE__ */ new Set(["-n", "--adjustment"]),
  time: /* @__PURE__ */ new Set(["-o", "--output", "-f"]),
  ionice: /* @__PURE__ */ new Set(["-c", "-n"]),
  setpriv: /* @__PURE__ */ new Set([
    "--ruid",
    "--euid",
    "--rgid",
    "--egid",
    "--reuid",
    "--regid",
    "--inh-caps",
    "--bounding-set",
    "--ambient-caps",
    "--groups",
    "--securebits",
    "--pdeathsig",
    "--selinux-label",
    "--apparmor-profile"
  ]),
  command: /* @__PURE__ */ new Set(),
  nohup: /* @__PURE__ */ new Set(),
  // stdbuf's -i/-o/-e take the buffer TYPE either attached (`-oL`) or as the
  // next token; both forms skip exactly one value.
  stdbuf: /* @__PURE__ */ new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
  fakeroot: /* @__PURE__ */ new Set(),
  setsid: /* @__PURE__ */ new Set(),
  unshare: /* @__PURE__ */ new Set([
    "--propagation",
    "--setgroups",
    "-R",
    "--root",
    "-w",
    "--wd",
    "-S",
    "--setuid",
    "-G",
    "--setgid",
    "--monotonic",
    "--boottime"
  ]),
  run0: /* @__PURE__ */ new Set(["--unit", "--service", "--slice", "--setenv", "--chdir"]),
  // systemd-run mostly uses = forms (self-contained tokens); the flags listed
  // here also accept a separate value token that must not be mistaken for the
  // wrapped command.
  "systemd-run": /* @__PURE__ */ new Set([
    "-p",
    "-E",
    "-H",
    "--host",
    "-M",
    "--property",
    "-u",
    "--unit",
    "--description",
    "--slice",
    "--uid",
    "--gid",
    "--nice",
    "--expand-environment",
    "--service-type",
    "--working-directory",
    "--setenv",
    "--machine",
    "--job-mode",
    "--on-active",
    "--on-boot",
    "--on-startup",
    "--on-calendar",
    "--on-unit-active",
    "--on-unit-inactive",
    "--timer-property",
    "--path-property",
    "--socket-property"
  ]),
  // strace/ltrace: -o/-e/-s take a separate value; their long forms are
  // = only. Tracing without a command (`strace -p PID`) has nothing to peel
  // after the PID is consumed.
  strace: /* @__PURE__ */ new Set(["-o", "-e", "-s", "-a", "-b", "-p", "-u"]),
  ltrace: /* @__PURE__ */ new Set(["-o", "-e", "-s", "-a", "-l", "-u"]),
  // watch's interval and equexit flags consume separate values; its pure flags
  // (-d, -g, -t, -b, -c, -e, …) stay absent like the other wrappers above.
  watch: /* @__PURE__ */ new Set(["-n", "--interval", "-q", "--equexit"]),
  // xargs value-taking options with a separate argument: without these the
  // generic peel would mistake the option's argument for the command. Pure
  // flags (-0, -r, -t, …) stay absent, as do options with optional arguments
  // (-e, -l, --replace), where skipping a following token could swallow the
  // real executable instead.
  xargs: /* @__PURE__ */ new Set([
    "-I",
    "-a",
    "-d",
    "-E",
    "-n",
    "-P",
    "-s",
    "-L",
    "--arg-file",
    "--delimiter",
    "--max-args",
    "--max-chars",
    "--max-procs",
    "--max-lines",
    "--process-slot-var"
  ]),
  // timeout value options; the DURATION operand itself is skipped by dedicated
  // handling in walk(), not by the generic loop.
  timeout: /* @__PURE__ */ new Set(["-k", "-s", "--kill-after", "--signal"]),
  exec: /* @__PURE__ */ new Set(["-a"])
};
var SHELL_BINARIES = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "mksh", "fish"]);
var SU_BINARIES = /* @__PURE__ */ new Set(["su", "runuser", "super"]);
var MAX_WALK_DEPTH = 32;
var MAX_EFFECTIVE_COMMANDS = 4096;
var MAX_ANALYSIS_INPUT_CHARS = 131072;
var MAX_LEX_TOKENS = 16384;
var MAX_REANALYSIS_CHARS = 262144;
function newAnalysisBudget() {
  return {
    remainingCommands: MAX_EFFECTIVE_COMMANDS,
    remainingReanalysisChars: MAX_REANALYSIS_CHARS
  };
}
var SSH_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-i",
  "-l",
  "-p",
  "-o",
  "-F",
  "-J",
  "-b",
  "-c",
  "-e",
  "-m",
  "-w",
  "-W",
  "-D",
  "-L",
  "-R",
  "-I",
  "-Q",
  "-O",
  "-E"
]);
function sshValueOption(token) {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1) return;
  for (let position = 1; position < token.length; position += 1) {
    const option = `-${token[position]}`;
    if (!SSH_VALUE_OPTIONS.has(option)) continue;
    const attached = token.slice(position + 1);
    return attached ? { option, attached } : { option };
  }
  return;
}
var SHELL_KEYWORDS = /* @__PURE__ */ new Set(["{", "}", "(", ")", "then", "else", "do", "elif", "!"]);
function basename(exe) {
  const slash = exe.lastIndexOf("/");
  return slash >= 0 ? exe.slice(slash + 1) : exe;
}
function tokenCharIsQuoted(token, index) {
  const spans = token.spans;
  if (spans === void 0) return token.raw !== token.value;
  let offset = 0;
  for (const span of spans) {
    if (index < offset + span.text.length) return span.quoted;
    offset += span.text.length;
  }
  return false;
}
function lexSegments(command, state) {
  const segments = [];
  let tokens = [];
  let value = "";
  let raw = "";
  let hasToken = false;
  let spans = [];
  let inSingle = false;
  let inDouble = false;
  let lastSeparator;
  let outOfTokens = false;
  const appendValue = (text, quoted) => {
    if (text.length === 0) return;
    const last = spans.at(-1);
    if (last !== void 0 && last.quoted === quoted) last.text += text;
    else spans.push({ text, quoted });
    value += text;
  };
  const flushToken = () => {
    if (hasToken) {
      tokens.push({ raw, value, spans });
      value = "";
      raw = "";
      spans = [];
      hasToken = false;
      if (state !== void 0) {
        state.tokensRemaining -= 1;
        if (state.tokensRemaining <= 0) outOfTokens = true;
      }
    }
  };
  const flushSegment = (endedBy) => {
    flushToken();
    if (tokens.length > 0 || endedBy === "(" || endedBy === ")") {
      segments.push({
        tokens,
        ...endedBy === void 0 ? {} : { endedBy },
        ...lastSeparator === void 0 ? {} : { precededBy: lastSeparator }
      });
      tokens = [];
    }
  };
  let i = 0;
  while (i < command.length) {
    if (outOfTokens) break;
    const c = command[i];
    if (inSingle) {
      raw += c;
      if (c === "'") inSingle = false;
      else appendValue(c, true);
      i += 1;
      continue;
    }
    if (inDouble) {
      raw += c;
      if (c === '"') {
        inDouble = false;
      } else if (c === "\\" && i + 1 < command.length) {
        const next = command[i + 1];
        raw += next;
        if (next === "\n" || next === "\r") {
          i += 2;
          continue;
        }
        if ('$`"\\'.includes(next)) {
          appendValue(next, true);
          i += 2;
          continue;
        }
        appendValue("\\", true);
        i += 1;
        continue;
      } else {
        appendValue(c, true);
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    if (c === "&" && (command[i + 1] === ">" || value.endsWith(">") && !tokenCharIsQuoted({ raw, value, spans }, value.length - 1)) || c === "|" && value.endsWith(">") && !tokenCharIsQuoted({ raw, value, spans }, value.length - 1)) {
      appendValue(c, false);
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    if (SEPARATORS.has(c)) {
      let endedBy = c === "\n" || c === "\r" ? ";" : c;
      if ((c === "|" || c === "&") && command[i + 1] === c) {
        endedBy = `${c}${c}`;
        i += 1;
      }
      flushSegment(endedBy);
      lastSeparator = endedBy;
      i += 1;
      continue;
    }
    if (WHITESPACE.has(c)) {
      flushToken();
      i += 1;
      continue;
    }
    if (c === "#" && !hasToken) {
      while (i < command.length && command[i] !== "\n") i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      const next = command[i + 1];
      raw += "\\" + next;
      if (next !== "\n" && next !== "\r") {
        appendValue(next, true);
        hasToken = true;
      }
      i += 2;
      continue;
    }
    appendValue(c, false);
    raw += c;
    hasToken = true;
    i += 1;
  }
  if (!outOfTokens) flushSegment();
  return segments;
}
function lexSegmentsBounded(command) {
  if (command.length > MAX_ANALYSIS_INPUT_CHARS) return { segments: [], truncated: true };
  const state = { tokensRemaining: MAX_LEX_TOKENS };
  const segments = lexSegments(command, state);
  return { segments, truncated: state.tokensRemaining <= 0 };
}
function analyzeEffectiveCommands(segment, budget) {
  const out = [];
  const redirections = [];
  const state = { truncated: false };
  const b = budget ?? newAnalysisBudget();
  walk(segment.tokens, out, redirections, [], 0, state, b);
  return { commands: out, redirections, truncated: state.truncated };
}
function walk(tokens, out, redirectionOut, inheritedRedirections, depth, state, budget) {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_EFFECTIVE_COMMANDS || budget.remainingCommands <= 0) {
    state.truncated = true;
    return;
  }
  const normalized = normalizeShellRedirections(tokens);
  tokens = normalized.tokens;
  const commandRedirections = [...inheritedRedirections, ...normalized.redirections];
  let i = 0;
  while (i < tokens.length && SHELL_KEYWORDS.has(tokens[i].value)) i += 1;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].value)) i += 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.value === "--") {
      break;
    }
    const base = basename(tok.value);
    if (base === "env") {
      const s = findEnvSCommand(tokens, i + 1);
      if (s !== null && s.script.length > 0) {
        const tail = tokens.slice(s.tailIndex).map((t) => t.value).join(" ");
        const reanalyzed = tail ? `${s.script} ${tail}` : s.script;
        budget.remainingReanalysisChars -= reanalyzed.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(reanalyzed))
          walk(sub.tokens, out, redirectionOut, commandRedirections, depth + 1, state, budget);
        return;
      }
    }
    if (base === "timeout") {
      const valueOpts = VALUE_OPTIONS.timeout ?? /* @__PURE__ */ new Set();
      let j = i + 1;
      while (j < tokens.length) {
        const opt = tokens[j].value;
        if (opt === "--") {
          j += 1;
          break;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          j = skipWrapperOption(tokens, j, valueOpts);
          continue;
        }
        break;
      }
      if (j < tokens.length) j += 1;
      if (j < tokens.length)
        walk(tokens.slice(j), out, redirectionOut, commandRedirections, depth + 1, state, budget);
      return;
    }
    if (TRANSPARENT_WRAPPERS.has(base)) {
      const valueOpts = VALUE_OPTIONS[base] ?? /* @__PURE__ */ new Set();
      i += 1;
      while (i < tokens.length) {
        const opt = tokens[i].value;
        if (opt === "--") {
          i += 1;
          break;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(opt)) {
          i += 1;
          continue;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          i = skipWrapperOption(tokens, i, valueOpts);
          continue;
        }
        break;
      }
      continue;
    }
    if (base === "script") {
      const command = findCommandString(tokens, i + 1);
      if (command !== null) {
        budget.remainingReanalysisChars -= command.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(command))
          walk(sub.tokens, out, redirectionOut, commandRedirections, depth + 1, state, budget);
        return;
      }
    }
    if (SHELL_BINARIES.has(base) || SU_BINARIES.has(base)) {
      const script = findCommandString(tokens, i + 1, SHELL_BINARIES.has(base) && base !== "fish");
      if (script !== null) {
        budget.remainingReanalysisChars -= script.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(script))
          walk(sub.tokens, out, redirectionOut, commandRedirections, depth + 1, state, budget);
        return;
      }
    }
    if (base === "ssh") {
      const rest = consumeSshRemote(tokens, i + 1);
      if (rest.length > 0) {
        const remote = rest.map((t) => t.value).join(" ");
        budget.remainingReanalysisChars -= remote.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(remote))
          walk(sub.tokens, out, redirectionOut, commandRedirections, depth + 1, state, budget);
      }
      return;
    }
    if (base === "busybox") {
      if (i + 1 < tokens.length)
        walk(
          tokens.slice(i + 1),
          out,
          redirectionOut,
          commandRedirections,
          depth + 1,
          state,
          budget
        );
      return;
    }
    if (base === "chroot") {
      let j = i + 1;
      while (j < tokens.length) {
        const opt = tokens[j].value;
        if (opt === "--") {
          j += 1;
          break;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          j += 1;
          continue;
        }
        break;
      }
      if (j + 1 < tokens.length)
        walk(
          tokens.slice(j + 1),
          out,
          redirectionOut,
          commandRedirections,
          depth + 1,
          state,
          budget
        );
      return;
    }
    out.push(tokens.slice(i));
    redirectionOut.push(commandRedirections);
    budget.remainingCommands -= 1;
    return;
  }
}
function sliceToken(token, start, end = token.value.length) {
  const value = token.value.slice(start, end);
  const spans = [];
  let offset = 0;
  for (const span of token.spans ?? [{ text: token.value, quoted: token.raw !== token.value }]) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    const from = Math.max(start, spanStart);
    const to = Math.min(end, spanEnd);
    if (from < to) {
      const text = span.text.slice(from - spanStart, to - spanStart);
      const previous = spans.at(-1);
      if (previous?.quoted === span.quoted) previous.text += text;
      else spans.push({ text, quoted: span.quoted });
    }
    offset = spanEnd;
  }
  return { raw: value, value, spans };
}
function redirectionOperatorAt(token, index) {
  const value = token.value;
  const live = (offset) => offset < value.length && !tokenCharIsQuoted(token, offset) ? value[offset] : void 0;
  const first = live(index);
  const tail = `${first ?? ""}${live(index + 1) ?? ""}${live(index + 2) ?? ""}`;
  if (tail.startsWith("&>>")) return "&>>";
  if (tail.startsWith("<<<")) return "<<<";
  if (tail.startsWith("<<-")) return "<<-";
  for (const operator of ["&>", ">>", ">|", ">&", "<<", "<&", "<>"]) {
    if (tail.startsWith(operator)) return operator;
  }
  if (first === ">" || first === "<") return first;
  return void 0;
}
function nextRedirection(token, start) {
  for (let index = start; index < token.value.length; index += 1) {
    const operator = redirectionOperatorAt(token, index);
    if (operator !== void 0) return { index, operator };
  }
  return void 0;
}
function normalizeShellRedirections(tokens) {
  const words = [];
  const redirections = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (/^<HEREDOC:sha256:[a-f0-9]+>$/.test(token.value)) {
      words.push(token);
      continue;
    }
    let cursor = 0;
    let found = nextRedirection(token, cursor);
    if (found === void 0) {
      words.push(token);
      continue;
    }
    while (found !== void 0) {
      let wordEnd = found.index;
      let operator = found.operator;
      const prefix = token.value.slice(cursor, found.index);
      if (cursor === 0 && /^[0-9]+$/.test(prefix)) {
        operator = `${prefix}${operator}`;
        wordEnd = cursor;
      }
      if (wordEnd > cursor) words.push(sliceToken(token, cursor, wordEnd));
      const targetStart = found.index + found.operator.length;
      const following = nextRedirection(token, targetStart);
      let targetToken;
      if (targetStart < (following?.index ?? token.value.length)) {
        targetToken = sliceToken(token, targetStart, following?.index);
      } else if (following === void 0) {
        const candidate = tokens[tokenIndex + 1];
        if (candidate !== void 0 && nextRedirection(candidate, 0)?.index !== 0) {
          tokenIndex += 1;
          targetToken = candidate;
        }
      }
      if (targetToken !== void 0) {
        redirections.push({
          operator,
          target: targetToken.value,
          quoted: targetToken.value.length > 0 && Array.from({ length: targetToken.value.length }, (_, index) => index).some(
            (index) => tokenCharIsQuoted(targetToken, index)
          )
        });
      }
      cursor = following?.index ?? token.value.length;
      found = following;
    }
  }
  return { tokens: words, redirections };
}
function skipWrapperOption(tokens, index, valueOpts) {
  const opt = tokens[index].value;
  if (valueOpts.has(opt)) return index + 2;
  if (opt.startsWith("--")) return index + 1;
  const letters = opt.slice(1);
  for (let position = 0; position < letters.length; position += 1) {
    if (valueOpts.has(`-${letters[position]}`)) {
      return position === letters.length - 1 ? index + 2 : index + 1;
    }
  }
  return index + 1;
}
function findCommandString(tokens, start, shellFlags = false) {
  let i = start;
  let endOfFlags = false;
  let shellCommandPending = false;
  while (i < tokens.length) {
    const t = tokens[i].value;
    if (!endOfFlags && t === "--") {
      if (shellFlags && shellCommandPending) {
        return i + 1 < tokens.length ? tokens[i + 1].value : null;
      }
      endOfFlags = true;
      i += 1;
      continue;
    }
    if (!endOfFlags && t === "-c") {
      if (shellFlags) {
        shellCommandPending = true;
        i += 1;
        continue;
      }
      return i + 1 < tokens.length ? tokens[i + 1].value : null;
    }
    if (!endOfFlags && t === "--command") {
      return i + 1 < tokens.length ? tokens[i + 1].value : null;
    }
    if (!endOfFlags && t.startsWith("--command=")) {
      return t.slice("--command=".length);
    }
    if (shellFlags && shellCommandPending) {
      if (!endOfFlags && (t === "-o" || t === "-O")) {
        i += 2;
        continue;
      }
      if (!endOfFlags && (t.startsWith("-") || t.startsWith("+")) && t.length > 1) {
        i += 1;
        continue;
      }
      return t;
    }
    if (!endOfFlags && t.startsWith("-") && !t.startsWith("--") && t.length > 1) {
      const cPosition = t.indexOf("c");
      if (cPosition === -1) {
        i += 1;
        continue;
      }
      if (shellFlags) {
        shellCommandPending = true;
        i += 1;
        continue;
      }
      if (cPosition === t.length - 1) {
        return i + 1 < tokens.length ? tokens[i + 1].value : null;
      }
      return t.slice(cPosition + 1);
    }
    i += 1;
  }
  return null;
}
function findEnvSCommand(tokens, start) {
  for (let i = start; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (value === "--") return null;
    if (value.startsWith("--")) {
      if (value === "--split-string") {
        const script = tokens[i + 1];
        if (script === void 0) return null;
        return { script: script.value, tailIndex: i + 2 };
      }
      if (value.startsWith("--split-string=")) {
        return { script: value.slice("--split-string=".length), tailIndex: i + 1 };
      }
      if (VALUE_OPTIONS.env.has(value)) i += 1;
      continue;
    }
    if (!value.startsWith("-") || value.length <= 1) return null;
    const letters = value.slice(1);
    for (let position = 0; position < letters.length; position += 1) {
      const letter = letters[position];
      if (letter === "S") {
        if (position === letters.length - 1) {
          const script = tokens[i + 1];
          if (script === void 0) return null;
          return { script: script.value, tailIndex: i + 2 };
        }
        return { script: letters.slice(position + 1), tailIndex: i + 1 };
      }
      if (letter === "u" || letter === "C" || letter === "P") {
        if (position === letters.length - 1) i += 1;
        break;
      }
    }
  }
  return null;
}
function consumeSshRemote(tokens, start) {
  let i = start;
  let hostSeen = false;
  while (i < tokens.length) {
    const t = tokens[i].value;
    if (t === "--") {
      i += 1;
      break;
    }
    if (t.startsWith("-") && t.length > 1) {
      const valued = sshValueOption(t);
      i += valued !== void 0 && valued.attached === void 0 ? 2 : 1;
      continue;
    }
    if (!hostSeen) {
      hostSeen = true;
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

// src/capability/heredoc-extractor.ts
import { createHash } from "crypto";
var MAX_BODY_BYTES = 4096;
var BARE_WORD_STOP = /* @__PURE__ */ new Set([
  " ",
  "	",
  "\n",
  "\r",
  "|",
  "&",
  ";",
  "<",
  ">",
  "(",
  ")",
  "\\",
  "'",
  '"'
]);
function parseDelimiterWord(command, start) {
  let index = start;
  let delimiter = "";
  let quoted = false;
  let resolved = true;
  let sawAny = false;
  while (index < command.length) {
    const c = command[index];
    if (c === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) {
        resolved = false;
        break;
      }
      delimiter += command.slice(index + 1, end);
      quoted = true;
      sawAny = true;
      index = end + 1;
      continue;
    }
    if (c === "$" && (command[index + 1] === "'" || command[index + 1] === '"')) {
      quoted = true;
      sawAny = true;
      if (command[index + 1] === "'") {
        const parsed = unescapeAnsiC(command, index + 2);
        if (!parsed.closed) {
          resolved = false;
          break;
        }
        delimiter += parsed.text;
        index = parsed.end;
      } else {
        index += 1;
      }
      continue;
    }
    if (c === '"') {
      index += 1;
      let closed = false;
      while (index < command.length) {
        const d = command[index];
        if (d === '"') {
          closed = true;
          index += 1;
          break;
        }
        if (d === "\\" && index + 1 < command.length) {
          const escaped = command[index + 1];
          if ('$`"\\'.includes(escaped)) delimiter += escaped;
          else delimiter += `\\${escaped}`;
          index += 2;
          continue;
        }
        delimiter += d;
        index += 1;
      }
      if (!closed) {
        resolved = false;
        break;
      }
      quoted = true;
      sawAny = true;
      continue;
    }
    if (c === "\\" && index + 1 < command.length) {
      delimiter += command[index + 1];
      quoted = true;
      sawAny = true;
      index += 2;
      continue;
    }
    if (BARE_WORD_STOP.has(c)) break;
    delimiter += c;
    sawAny = true;
    index += 1;
  }
  if (!sawAny) return { wordEnd: start, delimiter: "", quoted: false, resolved: false };
  return { wordEnd: index, delimiter, quoted, resolved };
}
function unescapeAnsiC(command, start) {
  let text = "";
  let index = start;
  while (index < command.length) {
    const c = command[index];
    if (c === "'") return { text, end: index + 1, closed: true };
    if (c !== "\\") {
      text += c;
      index += 1;
      continue;
    }
    const escaped = command[index + 1];
    if (escaped === void 0) break;
    if (escaped === "x") {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(command.slice(index + 2));
      if (hex === null) {
        text += "x";
        index += 2;
        continue;
      }
      text += String.fromCharCode(Number.parseInt(hex[0], 16));
      index += 2 + hex[0].length;
      continue;
    }
    if (/^[0-7]/.test(escaped)) {
      const octal = /^[0-7]{1,3}/.exec(command.slice(index + 1));
      text += String.fromCharCode(Number.parseInt(octal[0], 8));
      index += 1 + octal[0].length;
      continue;
    }
    const simple = {
      a: "\x07",
      b: "\b",
      e: "\x1B",
      E: "\x1B",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "	",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"'
    };
    text += simple[escaped] ?? escaped;
    index += 2;
  }
  return { text, end: index, closed: false };
}
function extractHeredocs(command) {
  const heredocs = [];
  let hasDynamicConstructs = false;
  let out = "";
  let cursor = 0;
  let i = 0;
  let lineStart = 0;
  let inSingle = false;
  let inDouble = false;
  let arithmeticDepth = 0;
  const pending = [];
  let pieces = [];
  const appendText = (text) => {
    if (text.length === 0) return;
    const last = pieces.at(-1);
    if (last !== void 0 && "text" in last) last.text += text;
    else pieces.push({ text });
  };
  const consumeBodies = (bodyStart, lineEnd) => {
    let position = bodyStart;
    const records = [];
    for (const start of pending) {
      let body;
      let truncated;
      if (start.resolved) {
        const collected = collectBody(command, position, start.delimiter, start.operator === "<<-");
        body = collected.body;
        truncated = collected.truncated;
        position = collected.endIndex + 1;
      } else {
        body = command.slice(position);
        truncated = true;
        position = command.length;
      }
      const sha256hex2 = createHash("sha256").update(body).digest("hex");
      const dynamic = start.resolved ? containsDynamic(body, start.quoted) : true;
      const { bounded, wasTruncated } = boundBody(body, truncated);
      if (dynamic) hasDynamicConstructs = true;
      const outputTarget = findOutputTarget(command.slice(start.lineStart, start.opStart)) ?? findOutputTarget(command.slice(start.wordEnd, lineEnd));
      records.push({
        bounded,
        sha256: sha256hex2,
        truncated: wasTruncated,
        dynamic,
        ...outputTarget === void 0 ? {} : { outputTarget }
      });
    }
    let assembled = "";
    for (const piece of pieces) {
      if ("text" in piece) {
        assembled += piece.text;
        continue;
      }
      const start = pending[piece.pendingIndex];
      const record = records[piece.pendingIndex];
      const shown = start.resolved ? start.delimiter : "<unresolved>";
      const safe = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(shown) ? shown : `'${shown.replace(/'/g, "'\\''")}'`;
      assembled += `${start.operator}${safe} <HEREDOC:sha256:${record.sha256.slice(0, 12)}>`;
    }
    out += assembled;
    for (let index = 0; index < pending.length; index += 1) {
      const start = pending[index];
      const record = records[index];
      heredocs.push({
        delimiter: start.resolved ? start.delimiter : start.rawWord,
        operator: start.operator,
        expansionDisabled: start.quoted,
        bodyBounded: record.bounded,
        bodySha256: record.sha256,
        truncated: record.truncated,
        ...record.outputTarget === void 0 ? {} : { outputTarget: record.outputTarget },
        dynamic: record.dynamic
      });
    }
    pending.length = 0;
    pieces = [];
    return position;
  };
  while (i < command.length) {
    const c = command[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (c === "\\") i += 1;
      else if (c === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      i += 2;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;&|()]/.test(command[i - 1]))) {
      while (i < command.length && command[i] !== "\n") i += 1;
      continue;
    }
    if (arithmeticDepth > 0) {
      if (c === "(") arithmeticDepth += 1;
      else if (c === ")") arithmeticDepth -= 1;
      i += 1;
      continue;
    }
    if (c === "$" && command[i + 1] === "(" && command[i + 2] === "(" || c === "(" && command[i + 1] === "(" && (i === 0 || /[\s;&|()]/.test(command[i - 1]))) {
      arithmeticDepth = 2;
      i += c === "$" ? 3 : 2;
      continue;
    }
    if (c === "\n") {
      if (pending.length > 0) {
        appendText(command.slice(cursor, i));
        const resume = consumeBodies(i + 1, i);
        out += "\n";
        cursor = i = resume;
        lineStart = resume;
        continue;
      }
      lineStart = i + 1;
      i += 1;
      continue;
    }
    if (c === "<" && command[i + 1] === "<") {
      let j = i + 2;
      const operator = command[j] === "-" ? "<<-" : "<<";
      if (operator === "<<-") j += 1;
      if (command[j] === "<") {
        i = j + 1;
        continue;
      }
      while (j < command.length && (command[j] === " " || command[j] === "	")) j += 1;
      const word = parseDelimiterWord(command, j);
      appendText(command.slice(cursor, i));
      pending.push({
        operator,
        delimiter: word.delimiter,
        rawWord: command.slice(j, word.wordEnd),
        quoted: word.quoted,
        resolved: word.resolved,
        opStart: i,
        wordEnd: word.wordEnd,
        lineStart
      });
      pieces.push({ pendingIndex: pending.length - 1 });
      cursor = i = word.wordEnd;
      continue;
    }
    i += 1;
  }
  if (pending.length > 0) {
    appendText(command.slice(cursor, command.length));
    consumeBodies(command.length, command.length);
    cursor = command.length;
  }
  out += command.slice(cursor);
  return { sanitizedCommand: out, heredocs, hasDynamicConstructs };
}
function findOutputTarget(beforeOperator) {
  const trimmed = beforeOperator.replace(/\s+$/, "");
  const match = />>?\s*([^\s|;&<>]+)\s*$/.exec(trimmed);
  return match === null ? void 0 : stripQuotes(match[1]);
}
function stripQuotes(token) {
  if (token.length >= 2) {
    const head = token[0];
    const tail = token[token.length - 1];
    if ((head === "'" || head === '"') && head === tail) return token.slice(1, -1);
  }
  return token;
}
function collectBody(source, start, delimiter, tabStripped) {
  let i = start;
  let body = "";
  let truncated = false;
  while (i < source.length) {
    let lineEnd = source.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = source.length;
    const line = source.slice(i, lineEnd);
    const candidate = tabStripped ? line.replace(/^\t+/, "") : line;
    if (candidate === delimiter) {
      return { body, endIndex: lineEnd, truncated };
    }
    body += line + "\n";
    if (body.length > MAX_BODY_BYTES * 4) truncated = true;
    i = lineEnd + 1;
  }
  truncated = true;
  return { body, endIndex: source.length, truncated };
}
function boundBody(fullBody, alreadyTruncated) {
  const bytes = Buffer.byteLength(fullBody, "utf8");
  if (bytes <= MAX_BODY_BYTES) return { bounded: fullBody, wasTruncated: alreadyTruncated };
  let cut = 0;
  let len = 0;
  while (cut < fullBody.length && len < MAX_BODY_BYTES) {
    len += Buffer.byteLength(fullBody[cut], "utf8");
    cut += 1;
  }
  return { bounded: fullBody.slice(0, cut) + "\n\u2026[truncated]", wasTruncated: true };
}
function containsDynamic(body, expansionDisabled) {
  if (expansionDisabled) return false;
  return /\$\(?|`/.test(body);
}

// src/capability/command-parser.ts
var REDIRECTION_OPS = /* @__PURE__ */ new Set([">", ">>", "<", "<<", ">&", "2>", "&>", "1>", "2>>", "&>>"]);
function parseCommand(rawCommand) {
  const { sanitizedCommand, heredocs, hasDynamicConstructs } = extractHeredocs(rawCommand);
  const lex = lexSegmentsBounded(sanitizedCommand);
  const segments = lex.segments;
  const effective = [];
  const redirections = [];
  let analysisTruncated = lex.truncated;
  const budget = newAnalysisBudget();
  for (const segment of segments) {
    const analysis = analyzeEffectiveCommands(segment, budget);
    analysisTruncated = analysisTruncated || analysis.truncated;
    for (let index = 0; index < analysis.commands.length; index += 1) {
      const cmd = analysis.commands[index];
      effective.push(cmd);
      redirections.push(analysis.redirections[index] ?? extractRedirections(cmd));
    }
  }
  const dyn = looksDynamic(sanitizedCommand);
  const dynamic = hasDynamicConstructs || dyn || segments.some((segment) => segmentHasDynamic(segment.tokens));
  return {
    sanitizedCommand,
    segments,
    effective,
    redirections,
    heredocs,
    hasDynamicConstructs: dynamic,
    analysisTruncated
  };
}
function extractRedirections(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const value = tok.value;
    const combined = /^([0-9]?>>?)\s*(.+)$/.exec(value);
    if (combined) {
      out.push({
        operator: combined[1],
        target: combined[2],
        quoted: isQuoted(combined[2], tok.raw)
      });
      continue;
    }
    if (REDIRECTION_OPS.has(value) && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      out.push({ operator: value, target: next.value, quoted: isQuoted(next.value, next.raw) });
      i += 1;
      continue;
    }
    if (value.startsWith(">") || value.startsWith("<")) {
      const op = value.startsWith(">>") ? ">>" : value[0];
      out.push({
        operator: op,
        target: value.slice(op === ">>" ? 2 : 1),
        quoted: isQuoted(value, tok.raw)
      });
    }
  }
  return out;
}
function isQuoted(value, raw) {
  if (raw.length < value.length) return true;
  const head = raw[0];
  const tail = raw[raw.length - 1];
  return (head === "'" || head === '"') && head === tail;
}
function looksDynamic(command) {
  const literal = command.replace(/'[^']*'/g, "");
  return /\$\(|`|\$\{|\$[A-Za-z_]|[?*]\s|<\(|>\(|\[\[/.test(literal);
}
function segmentHasDynamic(tokens) {
  return tokens.some((tok) => /\$|[*?]/.test(tok.value) && !isAllLiteral(tok.raw));
}
function isAllLiteral(raw) {
  return /^'[^']*'$/.test(raw);
}

// src/capability/bash-analyzer.ts
import { homedir as homedir2 } from "os";
import { normalize, resolve, sep } from "path";

// src/capability/sensitive-paths.ts
var SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/gcloud(?:\/|$)|\.config\/gh\/hosts\.yml$|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|credentials(?:\.json)?$|authorized_keys$|known_hosts$|\.npmrc$|\.pypirc$|\.netrc$)/i;
var NON_SECRET_SUFFIX = /\.(?:example|sample|template|dist|pub)$/i;
function isSensitivePathToken(path) {
  if (!path) return false;
  if (NON_SECRET_SUFFIX.test(path)) return false;
  return SENSITIVE_PATH.test(path);
}

// src/capability/bash-analyzer.ts
var INTERPRETERS = /* @__PURE__ */ new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "ash",
  "mksh",
  "fish",
  "python",
  "python2",
  "python3",
  "py",
  "node",
  "nodejs",
  "bun",
  "deno",
  "tsx",
  "ruby",
  "rb",
  "perl",
  "php",
  "lua",
  "tclsh",
  "wish",
  "java",
  "javac",
  "dotnet",
  "Rscript",
  "julia",
  "awk",
  "gawk",
  "nawk"
]);
var TEST_RUNNERS = /* @__PURE__ */ new Set([
  "pytest",
  "py.test",
  "unittest",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "karma",
  "jasmine",
  "cypress",
  "playwright",
  "nx",
  "rake",
  "rspec",
  "minitest",
  "go",
  // `go test`
  "cargo",
  // `cargo test`
  "gradle",
  // `gradle test`
  "mvn",
  // `mvn test`
  "make",
  // often runs a test target
  "cmake",
  "ctest",
  "tap",
  "tape",
  "nu"
]);
var PACKAGE_MANAGERS = /* @__PURE__ */ new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  // also an interpreter; dual-classified below
  "pip",
  "pip3",
  "pipx",
  "poetry",
  "uv",
  "conda",
  "mamba",
  "gem",
  "bundle",
  "cargo",
  "go",
  // `go get` / `go install`
  "composer",
  "mvn",
  "gradle",
  "apt",
  "apt-get",
  "apk",
  "dnf",
  "yum",
  "zypper",
  "pacman",
  "brew",
  "port",
  "nix",
  "flatpak",
  "snap",
  "choco",
  "scoop",
  "winget"
]);
var PACKAGE_SUBCOMMANDS = {
  npm: /* @__PURE__ */ new Set(["install", "i", "add", "ci", "update", "upgrade", "run", "exec", "x"]),
  pnpm: /* @__PURE__ */ new Set(["install", "add", "update", "upgrade", "exec", "run", "dlx"]),
  yarn: /* @__PURE__ */ new Set(["add", "install", "upgrade", "remove", "run", "exec"]),
  bun: /* @__PURE__ */ new Set(["add", "install", "update", "upgrade", "remove", "run", "x"]),
  pip: /* @__PURE__ */ new Set(["install", "download"]),
  pip3: /* @__PURE__ */ new Set(["install", "download"]),
  poetry: /* @__PURE__ */ new Set(["install", "add", "update", "upgrade"]),
  uv: /* @__PURE__ */ new Set(["pip install", "add", "sync"]),
  pipx: /* @__PURE__ */ new Set(["install", "inject", "upgrade"]),
  conda: /* @__PURE__ */ new Set(["install", "create", "update"]),
  gem: /* @__PURE__ */ new Set(["install", "update"]),
  bundle: /* @__PURE__ */ new Set(["install", "update"]),
  cargo: /* @__PURE__ */ new Set(["install", "add", "update", "fetch"]),
  go: /* @__PURE__ */ new Set(["get", "install", "mod download", "mod tidy"]),
  composer: /* @__PURE__ */ new Set(["install", "update", "require"]),
  apt: /* @__PURE__ */ new Set(["install", "upgrade", "update", "remove", "purge"]),
  "apt-get": /* @__PURE__ */ new Set(["install", "upgrade", "update", "remove", "purge"]),
  apk: /* @__PURE__ */ new Set(["add", "upgrade", "del"]),
  dnf: /* @__PURE__ */ new Set(["install", "upgrade", "remove"]),
  yum: /* @__PURE__ */ new Set(["install", "upgrade", "remove"]),
  pacman: /* @__PURE__ */ new Set(["-S", "-Sy", "-Syu", "-R", "-Rs"]),
  brew: /* @__PURE__ */ new Set(["install", "upgrade", "reinstall"])
};
var NETWORK_CLIENTS = /* @__PURE__ */ new Set([
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "socat",
  "ftp",
  "sftp",
  "scp",
  "rsync",
  "telnet",
  "dig",
  "nslookup",
  "host",
  "ping",
  "traceroute",
  "openssl",
  "httpie",
  "http",
  "aria2c",
  "axon"
]);
var FILE_WRITE_TOOLS = /* @__PURE__ */ new Set(["tee", "dd", "install", "truncate", "shred"]);
var FILE_MUTATION_TOOLS = /* @__PURE__ */ new Set(["cp", "mv", "rename", "ln", "link", "symlink", "rsync"]);
var MUTATION_VALUE_OPTIONS = {
  cp: /* @__PURE__ */ new Set(["-t", "--target-directory", "-S", "--suffix"]),
  mv: /* @__PURE__ */ new Set(["-t", "--target-directory", "-S", "--suffix"]),
  ln: /* @__PURE__ */ new Set(["-t", "--target-directory", "-S", "--suffix"]),
  rsync: /* @__PURE__ */ new Set([
    "--backup-dir",
    "-e",
    "--rsh",
    "--rsync-path",
    "--exclude-from",
    "--include-from",
    "--files-from",
    "--suffix",
    "--password-file",
    "--log-file",
    "--out-format"
  ])
};
function isRemoteMutationOperand(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) return true;
  const colon = value.indexOf(":");
  return colon > 0 && !value.slice(0, colon).includes("/");
}
function mutationOperands(base, cmd) {
  const valueOpts = MUTATION_VALUE_OPTIONS[base] ?? /* @__PURE__ */ new Set();
  const operands = [];
  let targetDirectory;
  let endOfOptions = false;
  for (let i = 1; i < cmd.length; i += 1) {
    const v = cmd[i].value;
    if (!endOfOptions && v === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && v.startsWith("--")) {
      if (valueOpts.has(v)) {
        if (v === "--target-directory") targetDirectory = cmd[i + 1]?.value;
        i += 1;
      } else if (valueOpts.has("--target-directory") && v.startsWith("--target-directory=")) {
        targetDirectory = v.slice("--target-directory=".length);
      }
      continue;
    }
    if (!endOfOptions && v.startsWith("-") && v.length > 1) {
      for (let position = 1; position < v.length; position += 1) {
        const option = `-${v[position]}`;
        if (!valueOpts.has(option)) continue;
        const attached = v.slice(position + 1);
        const value = attached || cmd[++i]?.value;
        if (option === "-t") targetDirectory = value;
        break;
      }
      continue;
    }
    operands.push(v);
  }
  if (targetDirectory !== void 0) {
    return { sources: operands, destinations: [targetDirectory], sawOperand: operands.length > 0 };
  }
  if (base === "rename") {
    return { sources: [], destinations: operands, sawOperand: operands.length > 0 };
  }
  if (base === "ln" && operands.length === 1) {
    return { sources: operands, destinations: ["."], sawOperand: true };
  }
  const destinations = [];
  if (operands.length > 0) destinations.push(operands[operands.length - 1]);
  const sources = operands.length > 1 ? operands.slice(0, -1) : [];
  return { sources, destinations, sawOperand: operands.length > 0 };
}
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set([
  "cat",
  "less",
  "more",
  "ls",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "pwd",
  "echo",
  "printf",
  "date",
  "whoami",
  "id",
  "uname",
  "hostname",
  "who",
  "w",
  "uptime",
  "which",
  "type",
  "printenv",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "du",
  "df",
  "tree",
  "jq",
  "yq",
  "sort",
  "uniq",
  "cut",
  "column",
  "tr",
  "diff",
  "cmp",
  "comm",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "cksum",
  "base64",
  "xxd",
  "od",
  "strings",
  "nl",
  "tac",
  "rev",
  "fold",
  "fmt",
  "expand",
  "unexpand",
  "seq",
  "true",
  "false",
  "sleep",
  "clear",
  "test",
  "[",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "man",
  "info",
  "tput"
]);
var NO_EFFECT_BUILTINS = /* @__PURE__ */ new Set([
  "cd",
  "pushd",
  "popd",
  "dirs",
  "export",
  "unset",
  "set",
  "shopt",
  "alias",
  "unalias",
  "exit",
  "return",
  "shift",
  "wait",
  "jobs",
  "fg",
  "bg",
  "read",
  "local",
  "declare",
  "readonly",
  "getopts",
  "hash",
  "help",
  "let",
  "trap",
  "ulimit",
  "umask",
  "builtin",
  "command"
]);
var DELETION_TOOLS = /* @__PURE__ */ new Set(["rm", "rmdir", "unlink", "shred", "truncate"]);
var GIT_MUTATION_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "config",
  "fetch",
  "filter-branch",
  "gc",
  "init",
  "maintenance",
  "merge",
  "mv",
  "notes",
  "prune",
  "pull",
  "push",
  "rebase",
  "remote",
  "repack",
  "replace",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "submodule",
  "switch",
  "symbolic-ref",
  "tag",
  "update-ref",
  "worktree"
]);
var GIT_NETWORK_SUBCOMMANDS = /* @__PURE__ */ new Set(["clone", "fetch", "ls-remote", "pull", "push"]);
var PRIVILEGE_WRAPPERS = /* @__PURE__ */ new Set([
  "sudo",
  "doas",
  "pkexec",
  "su",
  "runuser",
  "super",
  "setpriv",
  "setcap",
  "capsh"
]);
var SERVICE_MANAGERS = /* @__PURE__ */ new Set([
  "systemctl",
  "service",
  "rc-service",
  "rc-update",
  "initctl",
  "launchctl",
  "supervisorctl",
  "pm2",
  "forever",
  "nodemon",
  "god",
  "circus"
]);
var PERSISTENCE_WRAPPERS = /* @__PURE__ */ new Set(["nohup", "setsid", "disown"]);
var PERSISTENCE_TOOLS = /* @__PURE__ */ new Set(["at", "atq", "atrm", "cron", "crontab"]);
var SSH_TOOLS = /* @__PURE__ */ new Set(["ssh", "mosh", "autossh"]);
var CREDENTIAL_READERS = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "sed",
  "awk",
  "base64",
  "xxd",
  "od",
  "strings",
  "source",
  "."
]);
var SHELL_KEYWORDS2 = /* @__PURE__ */ new Set(["{", "}", "(", ")", "then", "else", "do", "elif", "!"]);
var directoryFallback = ".";
function readOnlyToolMutation(cmd, base) {
  if (base === "find") {
    let index = 1;
    while (index < cmd.length) {
      const value = cmd[index].value;
      if (value === "--") {
        index += 1;
        break;
      }
      if (value === "-D") {
        index += 2;
        continue;
      }
      if (value === "-H" || value === "-L" || value === "-P" || /^-O\d+$/.test(value)) {
        index += 1;
        continue;
      }
      break;
    }
    const roots = [];
    while (index < cmd.length && !cmd[index].value.startsWith("-") && cmd[index].value !== "!" && cmd[index].value !== "(") {
      roots.push(cmd[index].value);
      index += 1;
    }
    const result = { writeTargets: [] };
    for (; index < cmd.length; index += 1) {
      const value = cmd[index].value;
      if (value === "-delete") {
        result.deletion = true;
        result.writeTargets.push(...roots);
      } else if (value.startsWith("-exec") || value.startsWith("-ok")) {
        result.executesCode = true;
      } else if (value === "-fls" || value.startsWith("-fprint")) {
        const target = cmd[index + 1]?.value;
        if (target !== void 0 && !target.startsWith("-")) result.writeTargets.push(target);
      }
    }
    return result.deletion || result.executesCode || result.writeTargets.length > 0 ? result : void 0;
  }
  if (base === "sort") {
    const result = { writeTargets: [] };
    for (let index = 1; index < cmd.length; index += 1) {
      const value = cmd[index].value;
      if (value === "-o" || value === "--output") {
        const target = cmd[index + 1]?.value;
        if (target !== void 0 && !target.startsWith("-")) result.writeTargets.push(target);
      } else if (value.startsWith("--output=")) {
        result.writeTargets.push(value.slice("--output=".length));
      } else if (value.startsWith("-o") && value.length > 2) {
        result.writeTargets.push(value.slice(2));
      }
    }
    return result.writeTargets.length > 0 ? result : void 0;
  }
  if (base === "yq") {
    if (!cmd.some((token) => token.value === "-i" || token.value === "--inplace")) return void 0;
    const targets = cmd.slice(1).map((token) => token.value).filter((value) => !value.startsWith("-"));
    return targets.length > 0 ? { writeTargets: targets } : { writeTargets: [directoryFallback] };
  }
  return void 0;
}
function hasCommandSubstitution(command) {
  return /\$\(|`/.test(command);
}
function staticFact(value, notes) {
  return {
    value,
    source: "static-analysis",
    confidence: value === "unknown" ? "unknown" : "high",
    ...notes === void 0 || notes.length === 0 ? {} : { notes }
  };
}
function heuristicFact(value, notes) {
  return {
    value,
    source: "heuristic",
    confidence: value === "unknown" ? "unknown" : "medium",
    ...notes === void 0 || notes.length === 0 ? {} : { notes }
  };
}
function hasInlineCodeOption(tokens) {
  if (tokens.length === 0) return { interpreter: "", inline: false };
  const base = basename(tokens[0].value);
  if (!INTERPRETERS.has(base)) return { interpreter: base, inline: false };
  for (let i = 1; i < tokens.length; i += 1) {
    const v = tokens[i].value;
    if (v === "-c" || v === "--command" || v === "-e" || v.startsWith("--command=")) {
      return { interpreter: base, inline: true };
    }
  }
  return { interpreter: base, inline: false };
}
function hasWriteRedirect(redirections) {
  return redirections.some(redirectionWritesPath);
}
function redirectionWritesPath(redirection) {
  const operator = redirection.operator.replace(/^\d+/, "");
  if ([">", ">>", ">|", "&>", "&>>", "<>"].includes(operator)) return true;
  return operator === ">&" && !/^\d/.test(redirection.operator) && redirection.target !== "-" && !/^\d+$/.test(redirection.target);
}
function classifyPath(target, directory, worktree) {
  if (!target || target.startsWith("&"))
    return { temporary: false, workspace: false, external: false };
  let temp = false;
  let external = false;
  let absolute;
  if (target === "~" || target.startsWith("~/")) {
    absolute = resolve(homedir2(), target.slice(target === "~" ? 1 : 2));
  } else if (!target.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(target)) {
    absolute = resolve(directory, target);
  } else {
    absolute = normalize(target);
  }
  const absolutePath = absolute.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolute);
  const within = (root) => {
    const normalizedRoot = normalize(root);
    return absolute === normalizedRoot || absolute.startsWith(`${normalizedRoot}${sep}`);
  };
  if (!absolutePath) {
    return { temporary: temp, workspace: false, external };
  }
  const workspace = within(directory) || within(worktree);
  temp = absolute === "/tmp" || absolute.startsWith("/tmp/") || absolute === "/var/tmp" || absolute.startsWith("/var/tmp/") || absolute === "/dev/shm" || absolute.startsWith("/dev/shm/") || absolute === "/dev/null";
  external = !workspace && !temp;
  return { temporary: temp, workspace, external };
}
function destinationFromTokens(tokens) {
  const out = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const v = tokens[i].value;
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\s]+/.test(v)) out.push(v);
    else if (/^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(\/[^\s]*)?$/i.test(v)) out.push(v);
  }
  return out;
}
function gitSubcommandOf(cmd) {
  let index = 1;
  while (index < cmd.length) {
    const value = cmd[index].value;
    if (value === "-C" || value === "-c" || value === "--git-dir" || value === "--work-tree" || value === "--namespace" || value === "--exec-path" || value === "--super-prefix") {
      index += 2;
      continue;
    }
    if (value.startsWith("-") && value.length > 1) {
      index += 1;
      continue;
    }
    return { sub: value, index };
  }
  return {};
}
function gitSubcommandMutates(cmd, sub, index) {
  if (!GIT_MUTATION_SUBCOMMANDS.has(sub)) return false;
  const args = cmd.slice(index + 1).map((token) => token.value);
  const positional = args.filter((value) => value !== "--" && !value.startsWith("-"));
  if (sub === "branch") {
    if (args.length === 0) return false;
    if (args.some(
      (value) => [
        "-a",
        "--all",
        "-r",
        "--remotes",
        "-l",
        "--list",
        "-v",
        "-vv",
        "--show-current",
        "--contains",
        "--no-contains",
        "--merged",
        "--no-merged",
        "--points-at",
        "--format",
        "--sort",
        "--column"
      ].includes(value)
    ))
      return false;
  }
  if (sub === "tag") {
    if (args.length === 0) return false;
    if (args.some(
      (value) => [
        "-l",
        "--list",
        "--contains",
        "--no-contains",
        "--merged",
        "--no-merged",
        "--points-at",
        "--format",
        "--sort",
        "--column"
      ].includes(value)
    ))
      return false;
  }
  if (sub === "remote") {
    return positional.length > 0 && !["show", "get-url"].includes(positional[0]);
  }
  if (sub === "config") {
    if (args.some(
      (value) => [
        "--list",
        "-l",
        "--get",
        "--get-all",
        "--get-regexp",
        "--get-urlmatch",
        "--show-origin",
        "--show-scope",
        "get",
        "get-all",
        "get-regexp",
        "get-urlmatch",
        "list"
      ].includes(value)
    ))
      return false;
    return positional.length >= 2 || args.some((value) => /(?:add|set|unset|remove|rename)/.test(value));
  }
  if (sub === "worktree" && (positional.length === 0 || positional[0] === "list")) return false;
  if (sub === "notes" && (positional.length === 0 || ["list", "show"].includes(positional[0])))
    return false;
  if (sub === "submodule" && (positional.length === 0 || ["status", "summary"].includes(positional[0])))
    return false;
  if (sub === "symbolic-ref") {
    return args.includes("--delete") || positional.length >= 2;
  }
  return true;
}
function isLiteralPathValue(value) {
  if (!value) return false;
  if (/[$`*?[\]{}]/.test(value)) return false;
  return true;
}
function analyzeCapability(parsed, directory, worktree) {
  const warnings = [];
  let executesCode = false;
  let executesRepositoryCode = false;
  let createsAdHocCode = false;
  let invokesTestRunner = false;
  let invokesPackageLifecycle = false;
  let temporaryWrite = false;
  let workspaceWrite = false;
  let externalWrite = false;
  let deletion = false;
  let networkObserved = false;
  let networkPossible = false;
  let childProcesses = false;
  let persistence = false;
  let privilegeEscalation = false;
  let remoteEnabled = false;
  let remoteMutation = false;
  let gitObserved = false;
  let gitMutation = false;
  let credentialRead = false;
  let sawReadOnlyExecutable = false;
  let sawUnknownExecutable = false;
  const destinations = [];
  let dominantClass = "unknown";
  let classConfidence = "low";
  const heredocOutputs = new Set(
    parsed.heredocs.map((h) => h.outputTarget).filter(Boolean)
  );
  for (const segment of parsed.segments) {
    let k = 0;
    while (k < segment.tokens.length && SHELL_KEYWORDS2.has(segment.tokens[k].value)) k += 1;
    while (k < segment.tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment.tokens[k].value)) {
      k += 1;
    }
    if (k < segment.tokens.length) {
      const head = basename(segment.tokens[k].value);
      if (PRIVILEGE_WRAPPERS.has(head)) {
        privilegeEscalation = true;
        childProcesses = true;
      }
      if (PERSISTENCE_WRAPPERS.has(head)) {
        persistence = true;
        childProcesses = true;
      }
      if (SSH_TOOLS.has(head)) {
        remoteEnabled = true;
        childProcesses = true;
        const tail = segment.tokens.slice(k + 1).flatMap((t) => t.value.split(/\s+/));
        if (tail.some((v) => GIT_MUTATION_SUBCOMMANDS.has(v) || v === "rm")) {
          remoteMutation = true;
        }
        if (dominantClass === "unknown") {
          dominantClass = "remote-operation";
          classConfidence = "high";
        }
      }
    }
  }
  for (const cmd of parsed.effective) {
    if (cmd.length === 0) continue;
    const base = basename(cmd[0].value);
    const roMutation = readOnlyToolMutation(cmd, base);
    if (roMutation !== void 0) {
      if (roMutation.deletion === true) deletion = true;
      if (roMutation.executesCode === true) {
        executesCode = true;
        childProcesses = true;
      }
      for (const target of roMutation.writeTargets) {
        const cls = classifyPath(target, directory, worktree);
        if (cls.temporary) temporaryWrite = true;
        if (cls.workspace) workspaceWrite = true;
        if (cls.external) externalWrite = true;
      }
    }
    if ((READ_ONLY_TOOLS.has(base) || NO_EFFECT_BUILTINS.has(base)) && roMutation === void 0 && !INTERPRETERS.has(base) && !PACKAGE_MANAGERS.has(base) && !NETWORK_CLIENTS.has(base) && !FILE_WRITE_TOOLS.has(base) && !FILE_MUTATION_TOOLS.has(base) && !DELETION_TOOLS.has(base) && !SERVICE_MANAGERS.has(base) && !PERSISTENCE_TOOLS.has(base) && !PRIVILEGE_WRAPPERS.has(base)) {
      sawReadOnlyExecutable = true;
    } else if (base !== "git" && !INTERPRETERS.has(base) && !TEST_RUNNERS.has(base) && !PACKAGE_MANAGERS.has(base) && !NETWORK_CLIENTS.has(base) && !SSH_TOOLS.has(base) && !FILE_WRITE_TOOLS.has(base) && !FILE_MUTATION_TOOLS.has(base) && !DELETION_TOOLS.has(base) && !SERVICE_MANAGERS.has(base) && !PERSISTENCE_TOOLS.has(base) && !PERSISTENCE_WRAPPERS.has(base) && !PRIVILEGE_WRAPPERS.has(base)) {
      sawUnknownExecutable = true;
    }
    if (INTERPRETERS.has(base)) {
      executesCode = true;
      if (["bun", "node", "python", "python3", "deno", "tsx"].includes(base)) {
        childProcesses = true;
      }
      const { inline } = hasInlineCodeOption(cmd);
      if (inline) createsAdHocCode = true;
      for (let i = 1; i < cmd.length; i += 1) {
        const arg = cmd[i].value;
        if (heredocOutputs.has(arg)) createsAdHocCode = true;
        if (arg.startsWith(directory) || arg.startsWith(worktree)) executesRepositoryCode = true;
      }
    }
    if (TEST_RUNNERS.has(base)) {
      invokesTestRunner = true;
      executesCode = true;
      executesRepositoryCode = true;
      childProcesses = true;
    }
    if (INTERPRETERS.has(base) || PACKAGE_MANAGERS.has(base)) {
      const sub = cmd[1]?.value;
      if (sub === "test" || sub === "t" || sub === "check" || sub === "verify") {
        invokesTestRunner = true;
        executesCode = true;
        executesRepositoryCode = true;
        childProcesses = true;
      }
    }
    if (PACKAGE_MANAGERS.has(base)) {
      const sub = cmd[1]?.value;
      const subs = PACKAGE_SUBCOMMANDS[base];
      if (subs === void 0 || sub === void 0 || subs.has(sub)) {
        invokesPackageLifecycle = true;
        childProcesses = true;
        networkPossible = true;
        if (["run", "exec"].includes(sub ?? "")) {
          executesCode = true;
          if (sub === "run") executesRepositoryCode = true;
        }
        if (!["run", "exec"].includes(sub ?? "")) networkObserved = true;
      }
    }
    if (NETWORK_CLIENTS.has(base)) {
      networkObserved = true;
      destinations.push(...destinationFromTokens(cmd));
      dominantClass = "network";
      classConfidence = "high";
    }
    if (SSH_TOOLS.has(base)) {
      remoteEnabled = true;
      childProcesses = true;
      if (cmd.some((t) => GIT_MUTATION_SUBCOMMANDS.has(t.value) || t.value === "rm")) {
        remoteMutation = true;
      }
      dominantClass = "remote-operation";
      classConfidence = "high";
    }
    if (FILE_WRITE_TOOLS.has(base)) {
      const outputOperands = base === "dd" ? cmd.slice(1).map((token) => token.value).filter((value) => value.startsWith("of=")).map((value) => value.slice(3)) : cmd.slice(1).map((token) => token.value);
      for (const output of outputOperands) {
        const cls = classifyPath(output, directory, worktree);
        if (cls.temporary) temporaryWrite = true;
        if (cls.workspace) workspaceWrite = true;
        if (cls.external) externalWrite = true;
      }
    }
    if (FILE_MUTATION_TOOLS.has(base)) {
      const { sources, destinations: destinations2, sawOperand } = mutationOperands(base, cmd);
      const optionEnd = cmd.findIndex((token) => token.value === "--");
      const mutatesSources = base === "mv" || base === "rsync" && cmd.slice(1, optionEnd < 0 ? cmd.length : optionEnd).some((token) => token.value === "--remove-source-files");
      const writeOperands = mutatesSources ? [...destinations2, ...sources] : destinations2;
      for (const operand of writeOperands) {
        if (base === "rsync" && isRemoteMutationOperand(operand)) {
          externalWrite = true;
          continue;
        }
        const cls = classifyPath(operand, directory, worktree);
        if (cls.temporary) temporaryWrite = true;
        if (cls.workspace) workspaceWrite = true;
        if (cls.external) externalWrite = true;
      }
      if (!sawOperand) workspaceWrite = true;
    }
    if (DELETION_TOOLS.has(base)) {
      deletion = true;
      let anyTarget = false;
      for (let i = 1; i < cmd.length; i += 1) {
        const v = cmd[i].value;
        if (v.startsWith("-")) continue;
        anyTarget = true;
        const cls = classifyPath(v, directory, worktree);
        if (cls.temporary) temporaryWrite = true;
        if (cls.workspace) workspaceWrite = true;
        if (cls.external) externalWrite = true;
      }
      if (!anyTarget) workspaceWrite = true;
    }
    if (base === "git") {
      gitObserved = true;
      const { sub, index } = gitSubcommandOf(cmd);
      if (sub !== void 0 && GIT_NETWORK_SUBCOMMANDS.has(sub)) {
        networkObserved = true;
      }
      if (sub !== void 0 && index !== void 0 && gitSubcommandMutates(cmd, sub, index)) {
        gitMutation = true;
        if (sub === "push") externalWrite = true;
        else workspaceWrite = true;
      } else if (sub !== void 0 && GIT_NETWORK_SUBCOMMANDS.has(sub)) {
        dominantClass = "network";
        classConfidence = "high";
      }
    }
    if (PRIVILEGE_WRAPPERS.has(base)) {
    }
    if (SERVICE_MANAGERS.has(base)) {
      persistence = true;
      childProcesses = true;
      privilegeEscalation = true;
      if (dominantClass === "unknown") {
        dominantClass = "service-management";
        classConfidence = "high";
      }
    }
    if (PERSISTENCE_TOOLS.has(base)) {
      persistence = true;
      childProcesses = true;
    }
  }
  for (let index = 0; index < parsed.effective.length; index += 1) {
    const cmd = parsed.effective[index];
    if (cmd.length === 0) continue;
    const base = basename(cmd[0].value);
    const redirects = parsed.redirections[index] ?? [];
    for (const r of redirects) {
      if (r.operator !== "<") continue;
      if (!isLiteralPathValue(r.target)) continue;
      if (isSensitivePathToken(r.target)) credentialRead = true;
    }
    if (!CREDENTIAL_READERS.has(base)) continue;
    for (let i = 1; i < cmd.length; i += 1) {
      const value = cmd[i].value;
      const prev = cmd[i - 1].value;
      if (prev === "<" || prev === ">" || prev === ">>" || prev === "<<") continue;
      if (/^[0-9]*[<>]/.test(prev)) continue;
      if (value === "--") continue;
      if (value.startsWith("-") && value.length > 1) continue;
      if (value === "<" || value === ">" || value === ">>" || value === "<<") continue;
      if (value.startsWith("<") || value.startsWith(">")) continue;
      if (!isLiteralPathValue(value)) continue;
      if (isSensitivePathToken(value)) credentialRead = true;
    }
  }
  for (const segRedirects of parsed.redirections) {
    if (hasWriteRedirect(segRedirects)) {
      for (const r of segRedirects) {
        if (!redirectionWritesPath(r)) continue;
        const cls = classifyPath(r.target, directory, worktree);
        if (cls.temporary) temporaryWrite = true;
        if (cls.workspace) workspaceWrite = true;
        if (cls.external) externalWrite = true;
      }
    }
  }
  for (const h of parsed.heredocs) {
    if (h.outputTarget !== void 0) {
      const cls = classifyPath(h.outputTarget, directory, worktree);
      if (cls.temporary) temporaryWrite = true;
      if (cls.workspace) workspaceWrite = true;
      if (cls.external) externalWrite = true;
    }
  }
  if (dominantClass === "unknown") {
    if (deletion) {
      dominantClass = "destruction";
      classConfidence = "high";
    } else if (gitMutation) {
      dominantClass = "git-mutation";
      classConfidence = "high";
    } else if (externalWrite) {
      dominantClass = "external-write";
      classConfidence = "high";
    } else if (createsAdHocCode || executesCode) {
      dominantClass = "code-execution";
      classConfidence = createsAdHocCode ? "high" : "medium";
    } else if (invokesPackageLifecycle) {
      dominantClass = "package-management";
      classConfidence = "high";
    } else if (persistence) {
      dominantClass = "persistence";
      classConfidence = "high";
    } else if (privilegeEscalation) {
      dominantClass = "privilege-escalation";
      classConfidence = "high";
    } else if (workspaceWrite) {
      dominantClass = "workspace-write";
      classConfidence = "medium";
    } else if (temporaryWrite) {
      dominantClass = "temporary-write";
      classConfidence = "high";
    } else if (sawUnknownExecutable) {
      dominantClass = "unknown";
      classConfidence = "low";
    } else if (sawReadOnlyExecutable || gitObserved && !gitMutation) {
      dominantClass = "read-only";
      classConfidence = "medium";
    } else {
      dominantClass = "unknown";
      classConfidence = "low";
    }
  }
  if (parsed.hasDynamicConstructs) {
    warnings.push("command contains dynamic constructs (variables, substitution, or globs)");
  }
  if (parsed.heredocs.length > 0 && parsed.heredocs.some((h) => h.dynamic)) {
    warnings.push("one or more heredoc bodies have unresolvable expansion");
  }
  const heredocTruncated = parsed.heredocs.some((h) => h.truncated);
  if (parsed.heredocs.length > 0 && heredocTruncated) {
    warnings.push("one or more heredoc bodies were truncated or never terminated");
  }
  if (parsed.analysisTruncated) {
    warnings.push("command structure exceeded the static analysis depth or expansion budget");
  }
  const parserCompleteness = parsed.hasDynamicConstructs ? hasCommandSubstitution(parsed.sanitizedCommand) || parsed.heredocs.some((h) => h.dynamic) ? "opaque" : "partial" : parsed.analysisTruncated || heredocTruncated ? "partial" : "complete-for-supported-form";
  const summaryParts = [dominantClass];
  if (createsAdHocCode) summaryParts.push("ad-hoc code");
  if (executesRepositoryCode) summaryParts.push("repository code");
  if (invokesPackageLifecycle) summaryParts.push("package lifecycle scripts");
  if (gitMutation) summaryParts.push("git mutation");
  if (networkObserved) summaryParts.push("network");
  if (persistence) summaryParts.push("persistence");
  if (privilegeEscalation) summaryParts.push("privilege escalation");
  return {
    actionClass: {
      value: dominantClass,
      source: "static-analysis",
      confidence: classConfidence
    },
    summary: summaryParts.join(", "),
    executesCode: staticFact(executesCode ? true : "unknown"),
    executesRepositoryCode: staticFact(executesRepositoryCode ? true : "unknown"),
    createsAdHocCode: staticFact(createsAdHocCode ? true : "unknown"),
    invokesExistingTestRunner: staticFact(invokesTestRunner ? true : "unknown"),
    invokesPackageLifecycleScripts: staticFact(invokesPackageLifecycle ? true : "unknown"),
    credentialRead: staticFact(credentialRead ? true : "unknown"),
    writeEffects: {
      temporaryWrite: staticFact(temporaryWrite ? true : "unknown"),
      workspaceWrite: staticFact(workspaceWrite ? true : "unknown"),
      externalWrite: staticFact(externalWrite ? true : "unknown"),
      deletion: staticFact(deletion ? true : "unknown")
    },
    network: {
      observed: staticFact(networkObserved ? true : "unknown"),
      possible: heuristicFact(networkObserved || networkPossible ? true : "unknown"),
      destinations,
      observedAccess: staticFact(networkObserved ? true : "unknown"),
      possibleAccess: heuristicFact(networkObserved || networkPossible ? true : "unknown")
    },
    process: {
      childProcesses: staticFact(childProcesses ? true : "unknown"),
      persistence: staticFact(persistence ? true : "unknown"),
      privilegeEscalation: staticFact(privilegeEscalation ? true : "unknown")
    },
    remote: {
      enabled: staticFact(remoteEnabled ? true : "unknown"),
      mutationHint: staticFact(remoteMutation ? true : "unknown")
    },
    git: {
      observed: staticFact(gitObserved ? true : "unknown"),
      possible: heuristicFact(gitMutation ? true : "unknown"),
      observedAccess: staticFact(gitObserved ? true : "unknown"),
      possibleAccess: heuristicFact("unknown")
    },
    parserCompleteness,
    analysisWarnings: warnings
  };
}

// src/policy/policy-engine.ts
import { createHash as createHash2 } from "crypto";
var EFFECT_SEVERITY = {
  deny: 3,
  manual: 2,
  review: 1,
  allow: 0
};
var EMPTY_TRACE_ROUTE = "review";
function evaluatePolicy(capability, actor, config, rules = []) {
  const effectiveRules = filterProjectAllowRules(rules);
  const effectivePolicyHash = hashEffectivePolicy(effectiveRules, config);
  const matched = [];
  for (const rule of effectiveRules) {
    if (matches(rule.when, capability, actor, config)) {
      matched.push({
        id: rule.id,
        source: rule.source,
        effect: rule.effect,
        reason: rule.reason
      });
    }
  }
  let finalRoute = EMPTY_TRACE_ROUTE;
  if (matched.length > 0) {
    let bestEffect = matched[0].effect;
    let bestSev = EFFECT_SEVERITY[matched[0].effect] ?? 1;
    for (let i = 1; i < matched.length; i += 1) {
      const sev = EFFECT_SEVERITY[matched[i].effect] ?? 1;
      if (sev > bestSev) {
        bestEffect = matched[i].effect;
        bestSev = sev;
      }
    }
    finalRoute = bestEffect;
  }
  return {
    effectivePolicyHash,
    matchedRules: matched,
    finalRoute,
    mode: config.enforcementMode
  };
}
function filterProjectAllowRules(rules) {
  return rules.filter((r) => !(r.source === "project" && r.effect === "allow"));
}
function matches(cond, cap, actor, config) {
  if (cond === void 0 || cond.always === true) return true;
  if (cond.actionClass !== void 0) {
    if (!Array.isArray(cond.actionClass) || cap === void 0) return false;
    if (!cond.actionClass.includes(cap.actionClass.value)) return false;
  }
  if (cond.actorProfile !== void 0) {
    if (!Array.isArray(cond.actorProfile) || actor === void 0) return false;
    if (!cond.actorProfile.includes(actor.profile.value)) return false;
  }
  if (cond.writesWorkspace === true && cap?.writeEffects.workspaceWrite.value !== true) return false;
  if (cond.writesExternal === true && cap?.writeEffects.externalWrite.value !== true) return false;
  if (cond.writesTemporary === true && cap?.writeEffects.temporaryWrite.value !== true) return false;
  if (cond.deletion === true && cap?.writeEffects.deletion.value !== true) return false;
  if (cond.executesCode === true && cap?.executesCode.value !== true) return false;
  if (cond.createsAdHocCode === true && cap?.createsAdHocCode.value !== true) return false;
  if (cond.packageManagement === true && cap?.invokesPackageLifecycleScripts.value !== true)
    return false;
  if (cond.gitMutation === true && cap?.git.possible.value !== true) return false;
  if (cond.networkObserved === true && cap?.network.observed.value !== true) return false;
  if (cond.credentialRead === true && cap?.credentialRead.value !== true) return false;
  if (cond.privilegeEscalation === true && cap?.process.privilegeEscalation.value !== true)
    return false;
  if (cond.remoteEnabled === true && cap?.remote.enabled.value !== true) return false;
  if (cond.persistence === true && cap?.process.persistence.value !== true) return false;
  if (cond.repositoryTrust !== void 0) {
    if (!Array.isArray(cond.repositoryTrust)) return false;
    if (!cond.repositoryTrust.includes(config.repositoryTrust)) return false;
  }
  return true;
}
function hashEffectivePolicy(rules, config) {
  const rulesCanonical = rules.map((r) => `${r.id}:${r.effect}:${JSON.stringify(r.when ?? null)}`).sort().join("|");
  const decisionConfig = JSON.stringify({
    confidenceThreshold: config.confidenceThreshold,
    minimumConfidence: config.riskPolicy.minimumConfidence,
    riskPolicyAllow: config.riskPolicy.allow,
    onInvalidDecision: config.riskPolicy.onInvalidDecision,
    onReviewerFailure: config.riskPolicy.onReviewerFailure,
    repositoryTrust: config.repositoryTrust,
    enforcementMode: config.enforcementMode,
    escalationMode: config.escalationMode,
    configDegraded: config.configDegraded?.length ?? 0
  });
  return createHash2("sha256").update(`${rulesCanonical}#${decisionConfig}`).digest("hex").slice(0, 16);
}

// src/audit.ts
import { mkdir } from "fs/promises";
import {
  closeSync as closeSync2,
  constants as fsConstants2,
  fchmodSync,
  fstatSync as fstatSync2,
  openSync as openSync2,
  readSync as readSync2,
  writeSync
} from "fs";
import { homedir as homedir3 } from "os";
import { dirname, resolve as resolve2 } from "path";

// src/redact.ts
var REDACT = (type) => `[REDACTED:${type}]`;
var RULES = [
  // PEM private key blocks (bounded to avoid pathological backtracking). The
  // optional ` BLOCK` arm covers ASCII-armored GPG secret keys
  // (`-----BEGIN PGP PRIVATE KEY BLOCK-----`), which the simpler alternation
  // missed because of the trailing ` BLOCK`.
  {
    re: /-----BEGIN (?:[A-Z ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]{0,8192}?-----END (?:[A-Z ]*PRIVATE KEY(?: BLOCK)?)-----/g,
    replace: () => REDACT("pem")
  },
  // Truncated PEM (BEGIN with no matching END within the complete-block
  // window above): redact from the BEGIN marker to the end of the string so a
  // long private key whose END was chopped by an upstream truncation cannot
  // leak its tail. The `*` quantifier is a single greedy linear scan (no
  // alternation), so it is safe from pathological backtracking.
  {
    re: /-----BEGIN (?:[A-Z ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*/g,
    replace: () => REDACT("pem")
  },
  // AWS access key ids: long-term (AKIA) and temporary/session (ASIA).
  { re: /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g, replace: () => REDACT("aws") },
  // GitHub tokens (ghu_ covers user-to-server OAuth tokens).
  { re: /\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{36,251}\b/g, replace: () => REDACT("github") },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,251}\b/g, replace: () => REDACT("github") },
  // OpenAI: project keys and long bare `sk-…` keys (excludes Anthropic).
  { re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, replace: () => REDACT("openai") },
  { re: /\bsk-(?!ant-)[A-Za-z0-9]{30,}\b/g, replace: () => REDACT("openai") },
  // Anthropic.
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replace: () => REDACT("anthropic") },
  // Slack tokens.
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: () => REDACT("slack") },
  // Google API key.
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => REDACT("google") },
  // Stripe live/test restricted/secret keys.
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: () => REDACT("stripe") },
  // GitLab, NVIDIA, Telegram bot tokens.
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replace: () => REDACT("gitlab") },
  { re: /\bnvapi-[A-Za-z0-9_-]{20,}\b/g, replace: () => REDACT("nvidia") },
  { re: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/g, replace: () => REDACT("telegram") },
  // JWT (three base64url segments).
  {
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => REDACT("jwt")
  },
  // Credentials embedded in a URL userinfo component. A password is optional:
  // token-as-username URLs are credentials too, while SCP-style git@host paths
  // have no URL scheme and stay untouched.
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@[\]]+)(?::[^\s/@[\]]*)?@/gi,
    replace: (_m, g) => `${g[0] ?? ""}${REDACT("userinfo")}@`
  },
  // Auth-scheme prefixes (Bearer / Basic / Token) followed by a token.
  // Case-insensitive so lowercase "bearer", "basic", "token" are caught too.
  {
    re: /\b(Bearer|Basic|Token)\s+(?!\[REDACTED)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, g) => {
      const scheme = g[0] ?? "";
      return `${scheme} ${REDACT(scheme.toLowerCase())}`;
    }
  },
  // Cookie headers.
  {
    re: /(^|[^A-Za-z0-9_])(Cookie|Set-Cookie)(\s*[:=]\s*)(["']?)(?!\[REDACTED)([A-Za-z0-9._~+/%=-]{8,})(["']?)/g,
    replace: (_m, g) => `${g[0] ?? ""}${g[1] ?? ""}${g[2] ?? ""}${g[3] ?? ""}${REDACT("credential")}${g[5] ?? ""}`
  },
  // Authorization-style headers and JSON/YAML keys.
  {
    re: /(^|[^A-Za-z0-9_])(authorization|proxy-authorization|x-api-key|x-auth-token)(\s*[:=]\s*)(["']?)(?!\[REDACTED)([A-Za-z0-9._~+/-]{8,})(["']?)/gi,
    replace: (_m, g) => `${g[0] ?? ""}${g[1] ?? ""}${g[2] ?? ""}${g[3] ?? ""}${REDACT("credential")}${g[5] ?? ""}`
  },
  // Generic credential assignments (covers compound env names like DB_PASSWORD,
  // AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN via the underscore-tolerant prefix).
  // First, compound variable names whose identifier contains a credential word.
  // Case-insensitive so lowercase forms (ssh_private_key, passphrase,
  // service_credentials) are caught alongside their UPPER_CASE counterparts.
  {
    re: /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|PASSPHRASE|CREDENTIALS?)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)(?!\[REDACTED)([^$`{}()\s"'#[\]]{8,})(["']?)/gi,
    replace: (_m, g) => `${g[0] ?? ""}${g[1] ?? ""}${g[2] ?? ""}${g[3] ?? ""}${REDACT("credential")}${g[5] ?? ""}`
  },
  // Then lowercase credential keywords as standalone-ish keys (also catches the
  // bare forms private_key / passphrase / credential that the compound rule
  // above misses because it requires a leading identifier).
  {
    re: /(^|_|[^A-Za-z0-9_])(api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|secret|password|passwd|token|cookie|csrf[_-]?token|session[_-]?id|sessionid|session|sid|private[_-]?key|passphrase|credentials?)(["']?\s*[:=]\s*["']?)(?!\[REDACTED)([^$`{}()\s"'#[\]]{8,})/gi,
    replace: (_m, g) => `${g[0] ?? ""}${g[1] ?? ""}${g[2] ?? ""}${REDACT("credential")}`
  }
];
function redactSecrets(input) {
  let result = input;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    result = result.replace(rule.re, (match, ...rest) => {
      const groups = rest.slice(0, rest.length - 2);
      return rule.replace(match, groups);
    });
  }
  return result;
}

// src/audit.ts
var DEFAULT_AUDIT_PATH = "~/.local/share/opencode/permission-reviewer-audit.jsonl";
var O_RDONLY2 = typeof fsConstants2.O_RDONLY === "number" ? fsConstants2.O_RDONLY : 0;
var O_WRONLY = typeof fsConstants2.O_WRONLY === "number" ? fsConstants2.O_WRONLY : 0;
var O_CREAT = typeof fsConstants2.O_CREAT === "number" ? fsConstants2.O_CREAT : 0;
var O_APPEND = typeof fsConstants2.O_APPEND === "number" ? fsConstants2.O_APPEND : 0;
var O_NOFOLLOW2 = typeof fsConstants2.O_NOFOLLOW === "number" ? fsConstants2.O_NOFOLLOW : 0;
var O_NONBLOCK2 = typeof fsConstants2.O_NONBLOCK === "number" ? fsConstants2.O_NONBLOCK : 0;
function expandHome(path) {
  if (path === "~") return homedir3();
  if (path.startsWith("~/")) return resolve2(homedir3(), path.slice(2));
  return resolve2(path);
}
function resolveAuditPath(config) {
  return expandHome(config.auditPath ?? DEFAULT_AUDIT_PATH);
}
var REQUIRED_AUDIT_FIELDS = [
  "timestamp",
  "requestID",
  "sessionID",
  "permission",
  "outcome",
  "reason"
];
function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}
var AUDIT_READ_CAP_BYTES = 64 * 1024 * 1024;
function readTail(path) {
  let fd;
  try {
    fd = openSync2(path, O_RDONLY2 | O_NONBLOCK2 | O_NOFOLLOW2);
    const info = fstatSync2(fd);
    if (!info.isFile()) return void 0;
    const size = info.size;
    const truncated = size > AUDIT_READ_CAP_BYTES;
    const length = truncated ? AUDIT_READ_CAP_BYTES : size;
    const buffer = Buffer.alloc(length);
    const offset = truncated ? size - length : 0;
    let atLineBoundary = false;
    if (truncated && offset > 0) {
      try {
        const probe = Buffer.alloc(1);
        const seen = readSync2(fd, probe, 0, 1, offset - 1);
        atLineBoundary = seen === 1 && probe[0] === 10;
      } catch {
        atLineBoundary = false;
      }
    }
    let read = 0;
    while (read < length) {
      const count = readSync2(fd, buffer, read, length - read, offset + read);
      if (count === 0) break;
      read += count;
    }
    let text = (read < length ? buffer.subarray(0, read) : buffer).toString("utf8");
    if (truncated && !atLineBoundary) {
      text = text.replace(/^[^\n]*\n/, "");
    }
    return { text, truncated };
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) closeSyncSafe(fd);
  }
}
function closeSyncSafe(fd) {
  try {
    closeSync2(fd);
  } catch {
  }
}
function readAuditSummary(path) {
  const summary = {
    path,
    exists: false,
    truncated: false,
    totalLines: 0,
    validRecords: 0,
    invalidLines: 0,
    bySchemaVersion: {},
    byHostGeneration: {},
    byApplication: {},
    byOutcome: {},
    byRiskLevel: {},
    byDecisionSource: {},
    byPermission: {},
    unknownActorNames: [],
    missingRequiredFields: []
  };
  const read = readTail(path);
  if (read === void 0) return summary;
  summary.exists = true;
  summary.truncated = read.truncated;
  const lines = read.text.split("\n").filter((line) => line.trim().length > 0);
  summary.totalLines = lines.length;
  const actorCounts = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      summary.invalidLines++;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      summary.invalidLines++;
      continue;
    }
    const record = parsed;
    summary.validRecords++;
    bump(summary.bySchemaVersion, String(record.schemaVersion ?? 1));
    bump(
      summary.byHostGeneration,
      record.hostGeneration === "v1" || record.hostGeneration === "v2" ? record.hostGeneration : "legacy-unspecified"
    );
    if (typeof record.application === "string" && [
      "evaluation-returned",
      "reply-accepted",
      "human-pending",
      "superseded",
      "cancelled",
      "unknown"
    ].includes(record.application))
      bump(summary.byApplication, record.application);
    if (typeof record.outcome === "string") bump(summary.byOutcome, record.outcome);
    bump(summary.byRiskLevel, typeof record.riskLevel === "string" ? record.riskLevel : "(none)");
    if (typeof record.decisionSource === "string")
      bump(summary.byDecisionSource, record.decisionSource);
    if (typeof record.permission === "string") bump(summary.byPermission, record.permission);
    if (typeof record.timestamp === "string") {
      if (summary.firstTimestamp === void 0 || record.timestamp < summary.firstTimestamp) {
        summary.firstTimestamp = record.timestamp;
      }
      if (summary.lastTimestamp === void 0 || record.timestamp > summary.lastTimestamp) {
        summary.lastTimestamp = record.timestamp;
      }
    }
    const missing = REQUIRED_AUDIT_FIELDS.filter((f) => record[f] === void 0);
    if (missing.length > 0) summary.missingRequiredFields.push({ lineNo, missing });
    const actor = typeof record.actor === "object" && record.actor !== null ? record.actor : void 0;
    const isUnknown = actor === void 0 || actor.profile === void 0 || actor.profile === "unknown" || actor.name === void 0 || actor.name === "";
    if (isUnknown) {
      const rawName = actor?.name ?? (record.actor === void 0 ? "(no actor field)" : "(unnamed)");
      const name = typeof rawName === "string" ? rawName : JSON.stringify(rawName);
      actorCounts.set(name, (actorCounts.get(name) ?? 0) + 1);
    }
  }
  summary.unknownActorNames = [...actorCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return summary;
}

// src/cli/init.ts
import { parseArgs } from "util";
import { homedir as homedir4 } from "os";
import { createHash as createHash3 } from "crypto";
import { satisfies } from "semver";
import { applyEdits, modify } from "jsonc-parser";
import {
  closeSync as closeSync3,
  constants as fsConstants3,
  existsSync,
  fstatSync as fstatSync3,
  ftruncateSync,
  fsyncSync,
  mkdirSync,
  openSync as openSync3,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync as writeSync2
} from "fs";
import { dirname as dirname2, join as join2, resolve as resolve3 } from "path";
import { fileURLToPath } from "url";

// src/opencode/host-guard.ts
var SUPPORTED_V2_RANGE = ">=2.0.3 <3";

// src/cli/init.ts
async function runInit(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      global: { type: "boolean" },
      tui: { type: "boolean" },
      host: { type: "string", default: "auto" },
      binary: { type: "string", default: "opencode" },
      "dry-run": { type: "boolean" },
      print: { type: "boolean" },
      yes: { type: "boolean" },
      json: { type: "boolean" },
      npm: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    },
    strict: true,
    allowPositionals: false
  });
  if (values.help) {
    process.stderr.write(usage());
    return 0;
  }
  const directory = values.project ?? process.cwd();
  if (!existsSync(directory)) {
    console.error(`init: project directory does not exist: ${directory}`);
    return 1;
  }
  const pkg = readPackageInfo();
  if (!["auto", "v1", "v2"].includes(values.host)) {
    console.error("init: --host must be auto, v1, or v2");
    return 2;
  }
  const versionChecks = await runVersionChecks(pkg, values.binary);
  if (values.host === "auto" && !versionChecks.find((check) => check.name === "opencode")?.ok) {
    console.error("init: detected host is unavailable or unsupported; no configuration was written");
    return 2;
  }
  const version = versionChecks.find((check) => check.name === "opencode")?.version;
  const detected = version?.startsWith("1.") ? "v1" : version?.startsWith("2.") ? "v2" : void 0;
  const host = values.host === "auto" ? detected : values.host;
  if (!host) {
    console.error("init: cannot determine the host; pass --host v1 or --host v2");
    return 2;
  }
  const entry = buildEntry(pkg, Boolean(values.npm), host);
  const targets = resolveTargets(directory, Boolean(values.global), Boolean(values.tui), host);
  const existingSnapshot = readConfigFile(targets.config);
  const existingConfig = existingSnapshot.status === "read" ? existingSnapshot.config : void 0;
  if (values.host === "auto" && existingConfig && (host === "v1" && "plugins" in existingConfig || host === "v2" && "plugin" in existingConfig)) {
    console.error("init: binary version and config format disagree; select --host explicitly");
    return 2;
  }
  const plans = [targets.config, ...targets.tui ? [targets.tui] : []].map(
    (p) => planFileChange(p, pkg, host)
  );
  if (values.print) {
    console.log(JSON.stringify(entry, null, 2));
    return 0;
  }
  if (values.json) {
    console.log(
      JSON.stringify(
        {
          command: "init",
          host,
          dryRun: Boolean(values["dry-run"]),
          package: { name: pkg.name, version: pkg.version, root: pkg.root },
          versionChecks,
          targets: plans.map((p) => ({
            path: p.path,
            exists: existsSync(p.path),
            action: p.action,
            ...p.backup ? { backup: p.backup } : {}
          })),
          entry,
          writes: [],
          plannedWrites: plans.filter((p) => p.action === "append" || p.action === "create").map((p) => p.path)
        },
        null,
        2
      )
    );
    return 0;
  }
  console.error(`init: opencode-permission-reviewer ${pkg.version}`);
  for (const c of versionChecks) {
    const tag = c.ok ? "ok" : "warning";
    console.error(`  ${c.name}: ${c.version} (${c.range}) ${tag}`);
  }
  console.error(`  entry: ${JSON.stringify(entry)}`);
  for (const plan of plans) {
    console.error(`  ${plan.path}: ${plan.action}`);
  }
  if (values["dry-run"]) {
    console.error("init: dry-run, no files written");
    console.error("rollback: (nothing was changed)");
    return 0;
  }
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      console.error("init: not a TTY; pass --yes to apply changes non-interactively");
      return 2;
    }
    process.stderr.write("Apply these changes? [y/N] ");
    const answer = (await readStdin()).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      console.error("init: aborted, nothing changed");
      return 0;
    }
  }
  return applyPlannedWrites(plans, entry, pkg, host);
}
function applyPlannedWrites(plans, entry, pkg, host = "v1") {
  const written = [];
  for (const plan of plans) {
    if (plan.action === "noop") continue;
    const fresh = planFileChange(plan.path, pkg, host);
    if (fresh.action !== plan.action || plan.fingerprint !== void 0 && fresh.fingerprint !== plan.fingerprint) {
      console.error(
        `init: ${plan.path} changed since planning (was ${plan.action}, now ${fresh.action}); refusing to write`
      );
      return 1;
    }
    if (fresh.action === "error") {
      console.error(
        `init: ${plan.path} is malformed or has a non-array "plugin" key; refusing to write`
      );
      return 1;
    }
    if (fresh.backup !== void 0 && existsSync(plan.path)) {
      console.error(`  backup: ${writeBackup(plan.path, fresh.backup)}`);
    }
    try {
      writeEntry(plan.path, entry, fresh.action === "create", host, fresh.fingerprint);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.error(`init: ${plan.path} was created concurrently; refusing to overwrite`);
      return 1;
    }
    written.push(plan.path);
  }
  console.error("init: done");
  console.error("next: restart OpenCode to load the plugin");
  console.error(
    'next: ensure at least one permission "ask" rule (e.g. bash), or the plugin is a no-op'
  );
  if (plans.some((p) => p.backup)) {
    console.error("rollback: restore from the .bak file above and restart OpenCode");
  }
  return 0;
}
function writeBackup(source, preferred) {
  let sourceFd;
  let data;
  try {
    sourceFd = openSync3(
      source,
      fsConstants3.O_RDONLY | fsConstants3.O_NOFOLLOW | fsConstants3.O_NONBLOCK
    );
    if (!fstatSync3(sourceFd).isFile()) throw new Error(`Config is not a regular file: ${source}`);
    data = readFileSync(sourceFd);
  } finally {
    if (sourceFd !== void 0) closeSync3(sourceFd);
  }
  let dest = preferred;
  for (; ; ) {
    try {
      writeFileSync(dest, data, { flag: "wx", mode: 384 });
      return dest;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      dest = backupPath(source);
    }
  }
}
function usage() {
  return `Usage:
  opencode-permission-reviewer init [--project <dir>] [--global] [--tui]
                                    [--npm] [--dry-run] [--print] [--yes] [--json]

Register the permission-reviewer plugin in an OpenCode config file.
Backs up the existing file before writing. Never overwrites an already-
registered entry or a malformed config.

  --project <dir>   target project directory (default: cwd)
  --global          target ~/.config/opencode/opencode.json
  --tui             also register in tui.json
  --host <host>     v1, v2, or auto (default); auto refuses uncertain detection
  --binary <path>   OpenCode binary used for version detection
  --npm             emit an npm spec entry instead of a path reference
  --dry-run         print the plan, write nothing
  --print           print only the plugin entry JSON to stdout
  --yes             skip confirmation (required when stdin is not a TTY)
  --json            print planned changes as JSON without writing files
`;
}
function readPackageInfo() {
  let dir = import.meta.dirname ?? process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join2(dir, "package.json");
    if (existsSync(candidate)) {
      const raw = JSON.parse(readFileSync(candidate, "utf8"));
      return {
        name: raw.name ?? "opencode-permission-reviewer",
        version: raw.version ?? "0.0.0",
        engines: raw.engines ?? {},
        root: dir
      };
    }
    const parent = dirname2(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("init: could not locate package.json");
}
function buildEntry(pkg, npm, host) {
  const fromNodeModules = pkg.root.includes(join2("node_modules", ""));
  if (npm || fromNodeModules) {
    const name = `${pkg.name}@^${pkg.version}`;
    return host === "v2" ? { package: name, options: {} } : name;
  }
  return host === "v2" ? { package: pkg.root, options: {} } : pkg.root;
}
function resolveTargets(directory, forceGlobal, wantTui, host) {
  const globalDir = join2(process.env.XDG_CONFIG_HOME ?? join2(homedir4(), ".config"), "opencode");
  const globalCfg = pickExisting([
    join2(globalDir, "opencode.json"),
    join2(globalDir, "opencode.jsonc")
  ]);
  const projectCfg = pickExisting([
    join2(directory, "opencode.json"),
    join2(directory, "opencode.jsonc"),
    join2(directory, ".opencode", "opencode.json"),
    join2(directory, ".opencode", "opencode.jsonc")
  ]);
  const configPath = forceGlobal ? globalCfg ?? join2(globalDir, "opencode.json") : projectCfg ?? globalCfg ?? join2(directory, "opencode.json");
  if (!wantTui) return { config: configPath };
  if (host === "v2") return { config: configPath, tui: join2(globalDir, "cli.json") };
  const tuiDir = forceGlobal ? globalDir : dirname2(configPath);
  const tuiPath = pickExisting([join2(tuiDir, "tui.json"), join2(tuiDir, "tui.jsonc")]) ?? join2(tuiDir, "tui.json");
  return { config: configPath, tui: tuiPath };
}
function pickExisting(candidates) {
  return candidates.find((p) => existsSync(p));
}
function readConfigFile(path) {
  let fd;
  try {
    fd = openSync3(path, fsConstants3.O_RDONLY | fsConstants3.O_NOFOLLOW | fsConstants3.O_NONBLOCK);
    if (!fstatSync3(fd).isFile()) return { status: "error" };
    const raw = readFileSync(fd);
    const config = parseConfigText(raw.toString("utf8"));
    if (config === null) return { status: "error" };
    return { status: "read", config, fingerprint: createHash3("sha256").update(raw).digest("hex") };
  } catch (error) {
    return { status: error.code === "ENOENT" ? "missing" : "error" };
  } finally {
    if (fd !== void 0) closeSync3(fd);
  }
}
function parseConfigText(raw) {
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(stripCommentsAndTrailingCommas(raw));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function isOurEntry(entry, pkg, directory) {
  let head;
  if (typeof entry === "string") {
    head = entry;
  } else if (Array.isArray(entry) && typeof entry[0] === "string") {
    head = entry[0];
  } else if (typeof entry === "object" && entry !== null && "package" in entry && typeof entry.package === "string") {
    head = entry.package;
  }
  if (head === void 0) return false;
  if (head === pkg.root || head === pkg.name || head.startsWith(`${pkg.name}@`)) return true;
  try {
    const path = head.startsWith("file:") ? fileURLToPath(head) : resolve3(directory, head);
    return realpathSync(path) === realpathSync(pkg.root);
  } catch {
    return false;
  }
}
function planFileChange(path, pkg, host = "v1") {
  const snapshot = readConfigFile(path);
  if (snapshot.status === "missing") return { path, action: "create" };
  if (snapshot.status === "error") return { path, action: "error" };
  const { config: cfg, fingerprint } = snapshot;
  const plugin = cfg[host === "v2" ? "plugins" : "plugin"];
  if (plugin === void 0) {
    return { path, action: "append", backup: backupPath(path), fingerprint };
  }
  if (!Array.isArray(plugin)) {
    return { path, action: "error" };
  }
  const matching = plugin.filter((entry) => isOurEntry(entry, pkg, dirname2(path)));
  if (matching.length > 1) return { path, action: "error" };
  if (matching.length === 1) {
    const existing = matching[0];
    const isObject = typeof existing === "object" && existing !== null && !Array.isArray(existing);
    if (isObject !== (host === "v2")) return { path, action: "error" };
    const spec = typeof existing === "string" ? existing : Array.isArray(existing) ? existing[0] : existing.package;
    if (typeof spec === "string" && spec.startsWith(`${pkg.name}@`) && spec !== `${pkg.name}@${pkg.version}`)
      return { path, action: "error" };
    return { path, action: "noop" };
  }
  return { path, action: "append", backup: backupPath(path), fingerprint };
}
function backupPath(path) {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let bak = `${path}.bak-${stamp}`;
  for (let i = 2; existsSync(bak); i++) bak = `${path}.bak-${stamp}-${i}`;
  return bak;
}
function writeEntry(path, entry, create, host = "v1", fingerprint) {
  const key = host === "v2" ? "plugins" : "plugin";
  if (create) {
    mkdirSync(dirname2(path), { recursive: true });
    const schema = path.includes("tui.json") || path.includes("tui.jsonc") ? "https://opencode.ai/tui.json" : "https://opencode.ai/config.json";
    const fresh = path.endsWith("cli.json") ? { [key]: [entry] } : { $schema: schema, [key]: [entry] };
    writeFileSync(path, `${JSON.stringify(fresh, null, 2)}
`, { encoding: "utf8", flag: "wx" });
    return;
  }
  let fd;
  try {
    fd = openSync3(path, fsConstants3.O_RDWR | fsConstants3.O_NOFOLLOW | fsConstants3.O_NONBLOCK);
    if (!fstatSync3(fd).isFile()) throw new Error("Config is not a regular file");
    const raw = readFileSync(fd, "utf8");
    if (fingerprint !== void 0 && createHash3("sha256").update(raw).digest("hex") !== fingerprint) {
      throw new Error("Config changed after planning; refusing to overwrite");
    }
    const cfg = parseConfigText(raw);
    if (!cfg || cfg[key] !== void 0 && !Array.isArray(cfg[key]))
      throw new Error("Invalid plugin config");
    const edits = modify(
      raw.trim() ? raw : "{}",
      cfg[key] === void 0 ? [key] : [key, -1],
      cfg[key] === void 0 ? [entry] : entry,
      {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" }
      }
    );
    const data = Buffer.from(applyEdits(raw.trim() ? raw : "{}", edits), "utf8");
    ftruncateSync(fd, 0);
    let written = 0;
    while (written < data.length) {
      written += writeSync2(fd, data, written, data.length - written, written);
    }
    fsyncSync(fd);
  } finally {
    if (fd !== void 0) closeSync3(fd);
  }
}
async function runVersionChecks(pkg, binary) {
  const checks = [];
  const bunVer = process.versions.bun ?? process.versions.node ?? "0.0.0";
  const bunRange = pkg.engines.bun ?? "(unstated)";
  checks.push({
    name: "bun",
    version: bunVer,
    range: bunRange,
    ok: !pkg.engines.bun || satisfies(bunVer, pkg.engines.bun)
  });
  const ocVersion = await probeOpencodeVersion(binary);
  const ocRange = pkg.engines.opencode ?? "(unstated)";
  checks.push({
    name: "opencode",
    version: ocVersion ?? "(not found)",
    range: ocRange,
    ok: ocVersion !== void 0 && (!pkg.engines.opencode || satisfies(ocVersion, pkg.engines.opencode)) && (!ocVersion.startsWith("2.") || satisfies(ocVersion, SUPPORTED_V2_RANGE))
  });
  return checks;
}
async function probeOpencodeVersion(binary = "opencode") {
  try {
    const proc = Bun.spawn({ cmd: [binary, "--version"], stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), 2e3);
    const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    clearTimeout(timer);
    if (code !== 0) return void 0;
    return (out.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/) ?? [])[0];
  } catch {
    return void 0;
  }
}
async function readStdin() {
  return new Response(await Bun.stdin.text()).text();
}

// src/opencode/v2/permission-codec.ts
function normalizeV2Permission(input, scope, actionInput) {
  const permission = input.action === "shell" ? "bash" : input.action === "subagent" ? "task" : input.action;
  const metadata = structuredClone(input.metadata ?? {});
  delete metadata.hostAgent;
  if (input.agent !== void 0) metadata.hostAgent = input.agent;
  const exactInput = typeof actionInput === "object" && actionInput !== null && !Array.isArray(actionInput) ? structuredClone(actionInput) : void 0;
  if (exactInput) {
    metadata.toolInput = exactInput;
    if (permission === "bash" && typeof exactInput.command === "string")
      metadata.command = exactInput.command;
  }
  const actionEvidenceComplete = permission === "bash" ? typeof metadata.command === "string" && metadata.command.trim().length > 0 : exactInput !== void 0;
  return {
    ...scope,
    host: "v2",
    nativeAction: input.action,
    actionEvidenceComplete,
    request: {
      id: scope.reviewID,
      sessionID: input.sessionID,
      permission,
      patterns: [...input.resources],
      metadata,
      always: [],
      ...input.source === void 0 ? {} : {
        tool: { messageID: input.source.messageID, callID: input.source.id }
      }
    }
  };
}

// src/opencode/v2/connection.ts
import { Buffer as Buffer2 } from "buffer";
import { readFile } from "fs/promises";
import { homedir as homedir5 } from "os";
import { join as join3 } from "path";
import { OpenCode } from "@opencode/client";

// src/ui/rpc.ts
var ReviewerRpc = {
  id: "opencode-permission-reviewer",
  methods: {
    identity: {
      input: { type: "object", additionalProperties: false },
      output: { type: "string" }
    },
    status: { input: { type: "object", additionalProperties: false }, output: { type: "object" } },
    snapshot: {
      input: { type: "object", additionalProperties: false },
      output: { type: "object" }
    }
  },
  events: { "review.updated": { schema: { type: "object" } } }
};

// src/opencode/v2/connection.ts
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]"]);
function validateHostEndpoint(url) {
  const endpoint = new URL(url);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error("Reviewer host URL must be HTTP(S) without embedded credentials");
  if (endpoint.protocol === "http:" && !LOOPBACK_HOSTS.has(endpoint.hostname))
    throw new Error("Reviewer host connections outside loopback require HTTPS");
  return endpoint;
}

// src/cli/explain.ts
import { OpenCode as OpenCode2 } from "@opencode/client";

// src/ssh-evidence.ts
import { createHash as createHash4 } from "crypto";
import { constants as fsConstants4 } from "fs";
import { open, lstat, realpath, readlink } from "fs/promises";
import { basename as basename2, isAbsolute, resolve as resolve4, sep as sep2 } from "path";
var O_RDONLY3 = typeof fsConstants4.O_RDONLY === "number" ? fsConstants4.O_RDONLY : 0;
var O_NOFOLLOW3 = typeof fsConstants4.O_NOFOLLOW === "number" ? fsConstants4.O_NOFOLLOW : 0;
var O_NONBLOCK3 = typeof fsConstants4.O_NONBLOCK === "number" ? fsConstants4.O_NONBLOCK : 0;
var SENSITIVE_PATH2 = /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/(?:gh|gcloud)(?:\/|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|credentials(?:\.json)?$|authorized_keys$|known_hosts$|\.npmrc$|\.pypirc$|\.netrc$)/i;
var SENSITIVE_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk|nvapi)-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9_-]{16,}|\bgithub_pat_[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i;
function sha256(value) {
  return createHash4("sha256").update(value).digest("hex");
}
function isWithinRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep2}`);
}
async function approvedEvidenceRoots(rootDirectory, worktree, temporaryPath = "/tmp/opencode") {
  const [directoryRoot, worktreeRoot, temporaryRoot] = await Promise.all([
    realpath(rootDirectory).catch(() => resolve4(rootDirectory)),
    worktree === void 0 ? void 0 : realpath(worktree).catch(() => resolve4(worktree)),
    temporaryEvidenceRoot(temporaryPath)
  ]);
  return [
    directoryRoot,
    ...worktreeRoot === void 0 ? [] : [worktreeRoot],
    ...temporaryRoot === void 0 ? [] : [temporaryRoot]
  ];
}
async function temporaryEvidenceRoot(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) return void 0;
    if (typeof process.getuid === "function") {
      const uid = process.getuid();
      if (typeof info.uid === "number" && info.uid !== uid) return void 0;
    }
    if (info.mode & 18) return void 0;
    return path;
  } catch {
    return void 0;
  }
}
async function descriptorRealPath(fd) {
  try {
    return await readlink(`/proc/self/fd/${fd}`);
  } catch {
    return void 0;
  }
}
async function includeFileOnce(source, directory, rootDirectory, worktree, maxChars) {
  const resolved = resolve4(directory, source);
  if (SENSITIVE_PATH2.test(resolved)) {
    return { source: "file", path: resolved, status: "blocked", reason: "sensitive path" };
  }
  try {
    const actual = await realpath(resolved);
    const roots = await approvedEvidenceRoots(rootDirectory, worktree);
    if (!roots.some((root) => isWithinRoot(actual, root))) {
      return {
        source: "file",
        path: resolved,
        status: "blocked",
        reason: "outside approved enrichment roots"
      };
    }
    if (SENSITIVE_PATH2.test(actual)) {
      return {
        source: "file",
        path: resolved,
        status: "blocked",
        reason: "sensitive resolved path"
      };
    }
    const limit = Math.max(1, maxChars);
    const handle = await open(actual, O_RDONLY3 | O_NOFOLLOW3 | O_NONBLOCK3);
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        return {
          source: "file",
          path: resolved,
          status: "unavailable",
          reason: "not a regular file"
        };
      }
      const fdPath = await descriptorRealPath(handle.fd);
      if (fdPath !== void 0) {
        if (!roots.some((root) => isWithinRoot(fdPath, root))) {
          return {
            source: "file",
            path: resolved,
            status: "blocked",
            reason: `open descriptor resolves outside approved enrichment roots (${fdPath})`
          };
        }
        if (SENSITIVE_PATH2.test(fdPath)) {
          return {
            source: "file",
            path: resolved,
            status: "blocked",
            reason: "sensitive resolved path"
          };
        }
      }
      const buffer = Buffer.alloc(Math.min(info.size, limit + 1));
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const { bytesRead: count } = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead
        );
        if (count === 0) break;
        bytesRead += count;
      }
      const shortRead = bytesRead < buffer.length;
      const included = buffer.subarray(0, Math.min(bytesRead, limit));
      const content = included.toString("utf8");
      const replacementCount = [...content].filter((character) => character === "\uFFFD").length;
      if (included.includes(0) || replacementCount > Math.max(2, content.length / 100)) {
        return {
          source: "file",
          path: resolved,
          status: "blocked",
          reason: "binary or non-text content",
          size: info.size
        };
      }
      if (SENSITIVE_CONTENT.test(content)) {
        return {
          source: "file",
          path: resolved,
          status: "blocked",
          reason: "possible literal credential or private key",
          size: info.size,
          includedSha256: sha256(included)
        };
      }
      return {
        source: "file",
        path: resolved,
        status: info.size > limit || shortRead ? "truncated" : "included",
        size: info.size,
        includedBytes: included.length,
        includedSha256: sha256(included),
        content
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      source: "file",
      path: isAbsolute(source) ? source : resolved,
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
function isMissingFile(result) {
  return result.status === "unavailable" && /\bENOENT\b|no such file or directory/i.test(result.reason ?? "");
}
async function includeEvidenceFile(source, directory, rootDirectory, worktree, maxChars) {
  const first = await includeFileOnce(source, directory, rootDirectory, worktree, maxChars);
  if (!isMissingFile(first)) return first;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  return includeFileOnce(source, directory, rootDirectory, worktree, maxChars);
}

// src/verified-ssh-script.ts
import { createHash as createHash5 } from "crypto";
var VERIFIED_SCRIPT_LIMIT = 64 * 1024;
var RECEIPT_LIFETIME_MS = 60 * 60 * 1e3;
function renderVerifiedSshScriptCommand(input) {
  const remote = `set -eu; f=$(mktemp /tmp/reviewer-script.XXXXXXXX); cleanup(){ rm -f -- $f; }; trap cleanup EXIT; cat >$f; sum=$(sha256sum $f); test \${sum%% *} = ${input.sha256}; ${input.shell} $f`;
  return `cat -- ${input.path} | ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5${input.port === void 0 ? "" : ` -p ${input.port}`} ${input.destination} '${remote}'`;
}

// src/cli/explain.ts
if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
async function runCli(argv) {
  const first = argv[0];
  const explicit = first !== void 0 && !first.startsWith("-");
  const command = explicit ? first : "explain";
  const rest = explicit ? argv.slice(1) : argv;
  try {
    switch (command) {
      case "init":
        return await runInit(rest);
      case "explain":
        return await runExplain(rest);
      case "doctor":
        return await runDoctor(rest);
      case "config":
        return await runConfig(rest);
      case "audit":
        return await runAudit(rest);
      case "script":
        return await runScript(rest);
      default:
        console.error(`unknown command: ${command}
${usage2()}`);
        return 2;
    }
  } catch (error) {
    if (error?.code === "ERR_PARSE_ARGS_INVALID_OPTION") {
      console.error(String(error.message ?? error));
      return 2;
    }
    console.error(String(error?.message ?? error));
    return 2;
  }
}
function usage2() {
  return `Usage:
  opencode-permission-reviewer init [--project <dir>] [--global] [--tui] [--dry-run] [--print] [--yes]
  opencode-permission-reviewer explain [--event <file>] [--project <dir>]
  opencode-permission-reviewer doctor [--project <dir>] [--json]
  opencode-permission-reviewer config print-effective [--project <dir>]
  opencode-permission-reviewer audit report [--path <file>] [--project <dir>] [--json]
  opencode-permission-reviewer script command --file <path> --host <host> [--port <port>] [--shell bash|sh]`;
}
async function runScript(argv) {
  const { values, positionals } = parseArgs2({
    args: argv,
    options: {
      file: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      shell: { type: "string" }
    },
    strict: true,
    allowPositionals: true
  });
  const file = values.file;
  const host = values.host;
  const shell = values.shell ?? "bash";
  const port = values.port === void 0 ? void 0 : Number(values.port);
  if (positionals.length !== 1 || positionals[0] !== "command" || !file || !/^[A-Za-z0-9_./-]+$/.test(file) || !host || !/^[A-Za-z0-9_.@-]+$/.test(host) || host.startsWith("-") || shell !== "bash" && shell !== "sh" || port !== void 0 && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    console.error(
      "Usage: script command --file <simple-path> --host <host> [--port <port>] [--shell bash|sh]"
    );
    return 2;
  }
  const directory = process.cwd();
  const evidence = await includeEvidenceFile(
    file,
    directory,
    directory,
    directory,
    VERIFIED_SCRIPT_LIMIT
  );
  if (evidence.status !== "included" || evidence.includedSha256 === void 0 || evidence.content === void 0 || redactSecrets(evidence.content) !== evidence.content) {
    console.error(
      `Script cannot be fully inspected (${evidence.status}). Use a text file of at most 64 KiB inside the workspace or /tmp/opencode, without secrets.`
    );
    return 1;
  }
  console.log(
    renderVerifiedSshScriptCommand({
      path: file,
      destination: host,
      ...port === void 0 ? {} : { port },
      sha256: evidence.includedSha256,
      shell
    })
  );
  return 0;
}
async function runExplain(argv) {
  const { values } = parseArgs2({
    args: argv,
    options: {
      event: { type: "string" },
      defaults: { type: "boolean" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    strict: true,
    allowPositionals: false
  });
  if (values.help) {
    console.error(`Usage: explain --event <fixture.json> [--project <dir>]
Reads a permission request JSON, runs the capability analyzer and policy engine
(observe mode), and prints the result as JSON.`);
    return 0;
  }
  let raw;
  if (values.event) {
    raw = readFileSync2(values.event, "utf8");
  } else {
    raw = await readStdin2();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("explain: input is not valid JSON");
    return 2;
  }
  const normalized = normalizeRequest(parsed);
  if (normalized === void 0) {
    console.error('explain: input must have "permission" and "metadata.command" or "patterns"');
    return 2;
  }
  const request = normalized.request;
  const directory = values.project ?? process.cwd();
  const config = values.defaults ? resolveConfig(void 0) : loadResolvedConfig(void 0, directory);
  const worktree = directory;
  const nativeResources = normalized.nativeAction !== void 0;
  const command = typeof request.metadata?.command === "string" ? request.metadata.command : nativeResources ? "" : (request.patterns ?? []).filter((p) => typeof p === "string").join("\n");
  const result = {
    permission: request.permission,
    command,
    configuration: values.defaults ? "defaults" : "effective",
    model: config.model,
    ...nativeResources ? {
      resources: request.patterns,
      actionEvidenceComplete: normalized.actionEvidenceComplete,
      nativeAction: normalized.nativeAction
    } : {}
  };
  if (request.permission === "bash" && command.trim()) {
    const parsedCmd = parseCommand(command);
    const capability = analyzeCapability(parsedCmd, directory, worktree);
    const policyTrace = evaluatePolicy(capability, void 0, config, config.policyRules);
    result.capability = capability;
    result.policyTrace = policyTrace;
  } else {
    result.capability = null;
    result.policyTrace = evaluatePolicy(void 0, void 0, config, config.policyRules);
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
async function runDoctor(argv) {
  const { values } = parseArgs2({
    args: argv,
    options: {
      project: { type: "string" },
      binary: { type: "string" },
      endpoint: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    },
    strict: true,
    allowPositionals: false
  });
  if (values.help) {
    console.error("Usage: doctor [--project <dir>] [--json]");
    return 0;
  }
  const directory = values.project ?? process.cwd();
  const pkg = readPackageJson();
  const config = loadResolvedConfig(void 0, directory);
  const sources = inspectConfigSources(directory);
  const effectiveHash = hashEffectivePolicy(filterProjectAllowRules(config.policyRules), config);
  const auditPath = resolveAuditPath(config);
  const auditWritable = await checkWritable(auditPath);
  let connected;
  if (values.endpoint) {
    const password = process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
    if (!password) throw new Error("Connected doctor requires OPENCODE_PASSWORD");
    const client = OpenCode2.make({
      baseUrl: validateHostEndpoint(values.endpoint).href,
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    });
    connected = await client.rpc(ReviewerRpc).status({}, { location: { directory }, signal: AbortSignal.timeout(5e3) });
  }
  const report = {
    mode: values.endpoint ? "connected" : "local-only",
    host: {
      binaryVersion: values.binary ? await probeOpencodeVersion(values.binary) ?? null : null,
      runtime: connected ?? null
    },
    version: {
      package: pkg.version,
      opencodeRange: pkg.engines.opencode ?? "(unstated)",
      runtime: `bun/${process.versions.bun ?? "?"}`
    },
    config: {
      global: sources.global,
      project: sources.project,
      model: config.model,
      enforcementMode: config.enforcementMode,
      repositoryTrust: config.repositoryTrust,
      policyRuleCount: config.policyRules.length,
      effectivePolicyHash: effectiveHash
    },
    audit: {
      path: auditPath,
      writable: auditWritable.ok,
      ...auditWritable.error ? { error: auditWritable.error } : {}
    }
  };
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.error(`opencode-permission-reviewer doctor ${pkg.version}`);
  console.error(`diagnostic mode: ${report.mode}`);
  console.error(`version`);
  console.error(`  package:    ${report.version.package}`);
  console.error(`  opencode:   ${report.version.opencodeRange} (engines.opencode)`);
  console.error(`  runtime:    ${report.version.runtime}`);
  console.error(`config`);
  console.error(`  global:     ${fmtSource(sources.global)}`);
  console.error(`  project:    ${fmtSource(sources.project)}`);
  console.error(`  model:      ${report.config.model}`);
  const modeNote = report.config.enforcementMode === "observe" ? "declarative rules audited only; reviewer auto-allow/deny remains active" : "declarative rules enforced; reviewer decisions unchanged";
  console.error(`  mode:       ${report.config.enforcementMode} (${modeNote})`);
  console.error(`  trust:      ${report.config.repositoryTrust}`);
  console.error(
    `  rules:      ${report.config.policyRuleCount} (effectivePolicyHash: ${effectiveHash})`
  );
  console.error(`audit`);
  console.error(`  path:       ${auditPath}`);
  console.error(
    `  writable:   ${auditWritable.ok ? "yes" : "no"}${auditWritable.error ? ` (${auditWritable.error})` : ""}`
  );
  return 0;
}
async function runConfig(argv) {
  const { values, positionals } = parseArgs2({
    args: argv,
    options: { project: { type: "string" }, help: { type: "boolean", short: "h" } },
    strict: true,
    allowPositionals: true
  });
  if (values.help || positionals[0] !== "print-effective") {
    console.error("Usage: config print-effective [--project <dir>]");
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(void 0, directory);
  const sources = inspectConfigSources(directory);
  const report = {
    command: "print-effective",
    directory,
    sources,
    config: redactConfig(config),
    policy: {
      ruleCount: config.policyRules.length,
      effectivePolicyHash: hashEffectivePolicy(filterProjectAllowRules(config.policyRules), config)
    }
  };
  console.log(JSON.stringify(report, null, 2));
  return 0;
}
async function runAudit(argv) {
  const { values, positionals } = parseArgs2({
    args: argv,
    options: {
      path: { type: "string" },
      project: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    },
    strict: true,
    allowPositionals: true
  });
  if (values.help || positionals[0] !== "report") {
    console.error("Usage: audit report [--path <file>] [--project <dir>] [--json]");
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(void 0, directory);
  const auditPath = values.path ? expandHome(values.path) : resolveAuditPath(config);
  const summary = readAuditSummary(auditPath);
  if (!summary.exists) {
    console.error(`audit report: ${auditPath}: no such file`);
    return 1;
  }
  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  printAuditHuman(summary);
  return 0;
}
function printAuditHuman(s) {
  console.log(`audit report: ${s.path}`);
  if (s.truncated) {
    console.log("  NOTE: only the most recent 64 MiB were summarized; counts and");
    console.log("  timestamps describe that tail, not the whole file.");
  }
  console.log(`  valid records:     ${s.validRecords} (invalid lines: ${s.invalidLines})`);
  console.log(`  schema versions:   ${fmtCounts(s.bySchemaVersion)}`);
  console.log(`  host generations:  ${fmtCounts(s.byHostGeneration)}`);
  console.log(`  application states:${fmtCounts(s.byApplication)}`);
  if (s.firstTimestamp || s.lastTimestamp) {
    console.log(`  time range:        ${s.firstTimestamp ?? "?"} \u2192 ${s.lastTimestamp ?? "?"}`);
  }
  console.log(`  by outcome:        ${fmtCounts(s.byOutcome)}`);
  console.log(`  by risk level:     ${fmtCounts(s.byRiskLevel)}`);
  if (Object.keys(s.byDecisionSource).length > 0) {
    console.log(`  by decision source:${fmtCounts(s.byDecisionSource)}`);
  }
  if (Object.keys(s.byPermission).length > 0) {
    console.log(`  by permission:     ${fmtCounts(s.byPermission)}`);
  }
  if (s.unknownActorNames.length > 0) {
    console.log(`  unknown actors:    ${s.unknownActorNames.length}`);
    for (const a of s.unknownActorNames.slice(0, 10)) console.log(`    ${a.name} (${a.count})`);
  }
  if (s.missingRequiredFields.length > 0) {
    console.log(`  missing required fields: ${s.missingRequiredFields.length}`);
    for (const m of s.missingRequiredFields.slice(0, 10)) {
      console.log(`    line ${m.lineNo}: missing ${m.missing.join(", ")}`);
    }
  }
}
function readPackageJson() {
  let dir = import.meta.dirname;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join4(dir, "package.json");
    if (existsSync2(candidate)) {
      const raw = JSON.parse(readFileSync2(candidate, "utf8"));
      return { version: raw.version, engines: raw.engines ?? {} };
    }
    const parent = dirname3(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate package.json");
}
function inspectConfigSources(directory) {
  return {
    global: inspectFile(globalConfigPath()),
    project: inspectFile(projectConfigPath(directory))
  };
}
function inspectFile(path) {
  try {
    const content = readFileSync2(path, "utf8");
    return { path, exists: true, sha256: sha256hex(content).slice(0, 16) };
  } catch {
    return { path, exists: false, sha256: null };
  }
}
function fmtSource(s) {
  return `${s.path}  exists=${s.exists ? "yes" : "no"}  sha256=${s.sha256 ?? "-"}`;
}
function fmtCounts(map) {
  const entries = Object.entries(map);
  if (entries.length === 0) return "(none)";
  return entries.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" | ");
}
async function checkWritable(path) {
  try {
    await mkdir2(dirname3(path), { recursive: true });
    const fh = await open2(path, "a", 384);
    await fh.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
function sha256hex(value) {
  return createHash6("sha256").update(value).digest("hex");
}
function redactConfig(config) {
  return config;
}
function readStdin2() {
  return new Promise((resolve5) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve5(data));
  });
}
function normalizeRequest(value) {
  if (typeof value !== "object" || value === null) return;
  const v = value;
  if (typeof v.action === "string" && Array.isArray(v.resources) && v.resources.every((resource) => typeof resource === "string")) {
    return normalizeV2Permission(
      {
        sessionID: typeof v.sessionID === "string" ? v.sessionID : "explain-session",
        action: v.action,
        resources: v.resources,
        effect: "ask",
        ...typeof v.agent === "string" ? { agent: v.agent } : {},
        metadata: typeof v.metadata === "object" && v.metadata !== null ? v.metadata : {}
      },
      { reviewID: "explain-dry-run", generation: "explain", directory: "", hostVersion: "2.0.3" },
      v.input
    );
  }
  if (typeof v.permission !== "string") return;
  const req = {
    id: typeof v.id === "string" ? v.id : "explain-dry-run",
    sessionID: typeof v.sessionID === "string" ? v.sessionID : "explain-session",
    permission: v.permission,
    patterns: Array.isArray(v.patterns) ? v.patterns : [],
    always: Array.isArray(v.always) ? v.always : [],
    metadata: typeof v.metadata === "object" && v.metadata !== null ? v.metadata : {}
  };
  if (typeof v.tool === "object" && v.tool !== null && typeof v.tool.messageID === "string") {
    req.tool = v.tool;
  }
  return { request: req };
}
export {
  runCli
};
