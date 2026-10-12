import { resolve } from "node:path";
import { summarize } from "./metrics.mjs";
import { assert, atomicJSON, exists, readJSON } from "./util.mjs";

const estimatedCost = (prices, u) =>
  prices &&
  u.complete &&
  Number.isFinite(prices.input) &&
  Number.isFinite(prices.output)
    ? {
        amount:
          (u.inputTokens * prices.input + u.outputTokens * prices.output) / 1e6,
        currency: "USD",
        basis:
          "Configured uncached input/output rates, ignoring cache/reasoning/provider-specific price tiers.",
      }
    : null;

/** Write the manifest of a new run, or check that an explicit resume matches the existing one. */
export async function claimOutput(paths, resume, manifest, fingerprint) {
  if (await exists(paths.manifestPath)) {
    assert(
      resume,
      "Output directory already contains a run. Use a new directory or explicit --resume.",
    );
    const prior = await readJSON(paths.manifestPath);
    assert(
      prior.fingerprint === fingerprint,
      "Resume fingerprint mismatch: dataset, labels, sources, profiles or settings changed.",
    );
    return;
  }
  assert(!resume, "Cannot resume: run.json is absent.");
  assert(
    !(await exists(paths.rowsPath)) && !(await exists(paths.attemptPath)),
    "Orphan result files exist; use another output directory.",
  );
  await atomicJSON(paths.manifestPath, {
    ...manifest,
    fingerprint,
    createdAt: new Date().toISOString(),
  });
}
/** Summarize the settled run, write summary.json, results.json and the run-end event, then report harness failures. */
export async function finishRun(
  run,
  { directory, rows, jobs, settled, safeModels, manifest },
) {
  const failures = settled.filter((x) => x.status === "rejected");
  const summary = summarize(rows, {
    bootstrap: run.cfg.bootstrap,
    seed: run.cfg.seed,
  });
  const complete =
    rows.length === jobs.length &&
    !rows.some((r) => ["budget-exhausted", "interrupted"].includes(r.status));
  Object.assign(summary, {
    runFingerprint: run.fingerprint,
    complete,
    expectedRows: jobs.length,
    completedRows: rows.length,
    httpAttemptsTotal: run.counters.calls,
    interrupted: run.abort.signal.aborted,
    harnessErrors: failures.map((x) => String(x.reason?.message ?? x.reason)),
    source: run.adapter.snapshot,
    modelsConfig: safeModels,
  });
  for (const [id, s] of Object.entries(summary.models))
    s.operational.estimatedCost = estimatedCost(
      safeModels.find((m) => m.id === id)?.pricesPerMillion,
      s.operational.usage,
    );
  await atomicJSON(resolve(directory, "summary.json"), summary);
  // Self-contained analysis document, including rows, returned rationales and all attempt logs.
  await atomicJSON(resolve(directory, "results.json"), {
    run: { ...manifest, fingerprint: run.fingerprint },
    summary,
    results: rows,
  });
  await run.io.events.write({
    event: "run-end",
    complete,
    at: new Date().toISOString(),
    completed: rows.length,
    expected: jobs.length,
  });
  if (failures.length)
    throw new Error(
      "Harness failure: " +
        summary.harnessErrors.join("; ") +
        ". Completed records are preserved.",
    );
  return summary;
}
