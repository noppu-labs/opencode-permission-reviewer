import { resolve } from "node:path";
import { runConfig, runModels, transportCompletion } from "./run-config.mjs";
import {
  indexJournal,
  readPrior,
  recoverInFlight,
  writer,
} from "./run-journal.mjs";
import { lockDirectory } from "./run-lock.mjs";
import { runManifest, runPaths } from "./run-manifest.mjs";
import { claimOutput, finishRun } from "./run-output.mjs";
import { jobList, runWorkers } from "./run-queue.mjs";
import { createExecutor } from "./run-rows.mjs";
import { shuffle } from "./sampling.mjs";
import { assert, sha256 } from "./util.mjs";

export async function runBenchmark({
  cases,
  datasetHash,
  models,
  adapter,
  out,
  options = {},
  completion = transportCompletion,
  onProgress = () => {},
}) {
  const cfg = runConfig(options);
  const safeModels = runModels(models, cfg);
  const resume = cfg.resume;
  const manifest = await runManifest({
    cases,
    datasetHash,
    adapter,
    cfg,
    safeModels,
  });
  const fingerprint = sha256(manifest),
    directory = resolve(out);
  const unlock = await lockDirectory(directory);
  const io = {};
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error("Interrupted by user"));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const paths = runPaths(directory);
    await claimOutput(paths, resume, manifest, fingerprint);
    const prior = await readPrior(paths, resume, fingerprint);
    io.rows = await writer(paths.rowsPath);
    io.attempts = await writer(paths.attemptPath);
    io.events = await writer(paths.eventsPath);
    const counters = {
      calls: prior.startedCalls.length,
      issuedCalls: 0,
      finished: prior.rows.length,
    };
    assert(
      counters.calls >= prior.journal.length,
      "Attempt journal is inconsistent with started HTTP calls.",
    );
    const journalByKey = indexJournal(prior.journal, fingerprint);
    await recoverInFlight(
      prior.startedCalls,
      journalByKey,
      fingerprint,
      io.attempts,
    );
    const jobs = jobList(cfg, cases, safeModels);
    const queue = shuffle(jobs, cfg.seed).filter(
      (j) => !prior.completed.has(j.key),
    );
    await io.events.write({
      event: "run-start",
      fingerprint,
      at: new Date().toISOString(),
      resume,
      remaining: queue.length,
      previousHTTPAttempts: counters.calls,
    });
    const run = {
      cfg,
      adapter,
      completion,
      fingerprint,
      journalByKey,
      counters,
      abort,
      io,
    };
    const settled = await runWorkers(run, {
      queue,
      jobs,
      rows: prior.rows,
      execute: createExecutor(run),
      onProgress,
    });
    return await finishRun(run, {
      directory,
      rows: prior.rows,
      jobs,
      settled,
      safeModels,
      manifest,
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await io.rows?.close();
    await io.attempts?.close();
    await io.events?.close();
    await unlock();
  }
}
