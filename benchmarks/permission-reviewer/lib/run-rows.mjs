import { caseDigest, modelInput } from "./dataset.mjs";
import { attemptJob } from "./run-attempts.mjs";

export function rowBase(c, model, repeat, fingerprint) {
  return {
    schemaVersion: 1,
    runFingerprint: fingerprint,
    caseId: c.id,
    caseHash: caseDigest(c),
    modelId: model.id,
    model: model.model,
    profile: model.format ?? "text",
    family: c.family,
    category: c.category,
    split: c.split,
    origin: c.origin,
    variant: c.variant,
    difficulty: c.difficulty,
    repeat,
    gold: structuredClone(c.gold),
    attack: c.attack,
    metamorphic: c.metamorphic,
    trajectory: c.trajectory,
  };
}
const runModeFor = (transport) =>
  transport === "opencode-v1"
    ? "opencode-v1-session-core-replay"
    : transport === "system-one"
      ? "system-one-core-replay"
      : "live-provider-core-replay";
function rowHead(run, { c, m, rep }, p) {
  const base = {
    ...rowBase(c, m, rep, run.fingerprint),
    runMode: runModeFor(m.transport),
    pluginSourceSha256: run.adapter.snapshot.sourceSha256,
    reachable: p.reachable,
    promptHash: p.promptHash,
    evidenceHash: p.evidenceHash,
    actionEvidenceComplete: p.actionEvidenceComplete,
  };
  if (run.cfg.storePrompts)
    base.prompt =
      m.transport === "system-one"
        ? { state: p.systemOne.state, questions: p.systemOne.questions }
        : { system: p.system, user: p.user };
  base.evidence = p.evidence;
  return base;
}
/** Run one job to its result row: prepare, replay or request attempts, then the plugin's core replay. */
export function createExecutor(run) {
  return async function execute(job) {
    const start = performance.now();
    const p = await run.adapter.prepare(modelInput(job.c), job.m);
    const base = rowHead(run, job, p);
    if (!p.reachable && run.cfg.track === "system") {
      return {
        ...base,
        status: "bypass",
        attempts: [],
        decision: null,
        firstDecision: null,
        gated: null,
        effective: p.bypass,
        elapsedMs: performance.now() - start,
      };
    }
    const s = await attemptJob(run, job, p);
    const final = await run.adapter.finish(
      p,
      s.parsed,
      s.errorKind,
      s.parsedSystemOne,
    );
    return {
      ...base,
      status: s.status,
      attempts: s.attempts,
      decision: s.parsed,
      firstDecision: s.firstDecision,
      exposedRationale: s.parsed?.rationale ?? null,
      systemOneDifficulty: s.parsedSystemOne?.difficultReason ?? null,
      systemOneReasoningRecommended:
        s.parsedSystemOne?.reasoningRecommended === true &&
        final.gated?.kind === "escalate",
      ...final,
      elapsedMs: performance.now() - start,
    };
  };
}
