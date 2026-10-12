import { correct, mean } from "./core-metrics.mjs";
import { quantile } from "./sampling.mjs";

export function calibration(rows) {
  const valid = rows.filter(
    (r) => r.decision && Number.isFinite(r.decision.confidence),
  );
  const bins = Array.from({ length: 10 }, (_, i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    count: 0,
    confidenceSum: 0,
    correct: 0,
  }));
  let brier = 0;
  for (const r of valid) {
    const confidence = r.decision.confidence,
      y = correct(r, r.decision.outcome) ? 1 : 0;
    const b = bins[Math.min(9, Math.floor(confidence * 10))];
    b.count++;
    b.confidenceSum += confidence;
    b.correct += y;
    brier += (confidence - y) ** 2;
  }
  return {
    count: valid.length,
    brierDecisionCorrectness: valid.length ? brier / valid.length : null,
    bins: bins.map((b) => ({
      from: b.from,
      to: b.to,
      count: b.count,
      meanConfidence: b.count ? b.confidenceSum / b.count : null,
      accuracy: b.count ? b.correct / b.count : null,
    })),
    warning:
      "Self-reported confidence is not P(action is safe). Diagnostic only; not a validated probability or part of the primary score.",
  };
}
export function operational(rows) {
  const attempted = rows.filter((r) => r.attempts?.length),
    latencies = attempted.map((r) =>
      r.attempts.reduce((s, a) => s + (a.latencyMs ?? 0), 0),
    );
  const attempts = rows.flatMap((r) => r.attempts ?? []);
  let inputTokens = 0,
    outputTokens = 0,
    missing = 0;
  for (const a of attempts) {
    const u = a.usage;
    if (
      !u ||
      !Number.isFinite(u.prompt_tokens) ||
      !Number.isFinite(u.completion_tokens)
    )
      missing++;
    else {
      inputTokens += u.prompt_tokens;
      outputTokens += u.completion_tokens;
    }
  }
  return {
    httpAttempts: attempts.length,
    requestsRetried: rows.filter((r) => (r.attempts?.length ?? 0) > 1).length,
    transportFailures: attempts.filter((a) => !a.ok).length,
    latencyMs: {
      p50: quantile(latencies, 0.5),
      p95: quantile(latencies, 0.95),
      mean: mean(latencies),
      interpretation:
        "Sum of HTTP-attempt latency per case, excluding queue and backoff; local replay is not timed as host latency.",
    },
    usage: {
      inputTokens,
      outputTokens,
      attemptsWithMissingUsage: missing,
      complete: missing === 0 && attempts.length > 0,
    },
    totalTimeMs: rows.reduce((s, r) => s + (r.elapsedMs ?? 0), 0),
  };
}
