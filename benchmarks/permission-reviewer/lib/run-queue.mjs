export function jobList(cfg, cases, safeModels) {
  const jobs = [];
  for (let rep = 0; rep < cfg.repeats; rep++)
    for (const c of cases)
      for (const m of safeModels)
        jobs.push({ c, m, rep, key: `${m.id}/${c.id}/${rep}` });
  return jobs;
}
/** Workers take the next queued job only after their previous one finished; the worker count is the provider concurrency limit. */
export function runWorkers(run, { queue, jobs, rows, execute, onProgress }) {
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length && !run.abort.signal.aborted) {
      const job = queue[cursor++];
      // Preparation/programming errors stop the run. Do not disguise harness defects as model failures.
      let row;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: each worker takes the next job from the shared queue cursor only after its previous job finished; the number of workers is the run's provider concurrency limit
        row = await execute(job);
      } catch (error) {
        run.abort.abort(error);
        throw error;
      }
      await run.io.rows.write(row);
      rows.push(row);
      run.counters.finished++;
      onProgress({
        finished: run.counters.finished,
        total: jobs.length,
        calls: run.counters.calls,
        last: job.key,
        status: row.status,
      });
    }
  }
  return Promise.allSettled(
    Array.from({ length: Math.min(run.cfg.concurrency, queue.length) }, worker),
  );
}
