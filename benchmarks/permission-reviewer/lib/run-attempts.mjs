import { randomInt } from "node:crypto";
import { TEXT_RETRY_NOTE } from "./providers.mjs";
import { journalReplay } from "./run-journal.mjs";
import { delay } from "./util.mjs";

const STOP = "stop";

const retryable = (a) =>
  !a.uncertainInFlight &&
  (a.status === null ||
    a.status === undefined ||
    a.status === 408 ||
    a.status === 429 ||
    a.status >= 500);

/** Claim one call from the run budget and send it; `stop` names why no call was sent. */
async function issueAttempt(run, job, p, s) {
  const { cfg, counters, io } = run;
  if (counters.calls >= cfg.maxCalls) return { stop: "budget-exhausted" };
  if (counters.issuedCalls > 0 && cfg.maxRequestDelayMs > 0) {
    const waitMs = randomInt(cfg.minRequestDelayMs, cfg.maxRequestDelayMs + 1);
    await io.events.write({
      event: "request-wait",
      key: job.key,
      waitMs,
      at: new Date().toISOString(),
    });
    await delay(waitMs);
  }
  if (run.abort.signal.aborted) return { stop: "interrupted" };
  counters.calls++;
  counters.issuedCalls++;
  await io.events.write({
    event: "http-start",
    key: job.key,
    ordinal: s.attempts.length + 1,
    at: new Date().toISOString(),
  });
  const attempt = await run.completion(job.m, p, {
    timeoutMs: cfg.timeoutMs,
    retryNote: s.retryNote,
    signal: run.abort.signal,
  });
  await io.attempts.write({
    schemaVersion: 1,
    runFingerprint: run.fingerprint,
    key: job.key,
    ordinal: s.attempts.length + 1,
    at: new Date().toISOString(),
    attempt,
  });
  return { attempt };
}
function decisionOf(run, p, a, s) {
  const extracted = a.extracted ?? {
    text: "",
    protocolError: "No extracted output.",
  };
  s.parsedSystemOne =
    !extracted.protocolError && extracted.systemOne
      ? (run.adapter.parseSystemOne(a.raw, p.config) ?? null)
      : null;
  return extracted.protocolError
    ? null
    : extracted.systemOne
      ? (s.parsedSystemOne?.decision ?? null)
      : (run.adapter.parse(extracted.text ?? "") ?? null);
}
function settleAnswer(run, job, p, s, a) {
  const d = decisionOf(run, p, a, s);
  if (s.attempts.length === 1) s.firstDecision = d;
  if (d) {
    s.parsed = d;
    s.status = "valid";
    return STOP;
  }
  s.errorKind = "invalid";
  s.status = "invalid";
  if (
    job.m.transport !== "system-one" &&
    s.parseRetries < run.cfg.formatRetries
  ) {
    s.parseRetries++;
    s.retryNote = TEXT_RETRY_NOTE;
    return 0;
  }
  return STOP;
}
/** Record one attempt on the job state; returns STOP, or the backoff in ms before the next attempt. */
function settle(run, job, p, s, a) {
  if (a.halt) {
    run.abort.abort(new Error("Transport requested a safety stop."));
    s.errorKind = "transport";
    s.status = "transport-error";
    return STOP;
  }
  if (a.ok) return settleAnswer(run, job, p, s, a);
  s.errorKind = "transport";
  s.status = "transport-error";
  if (retryable(a) && s.transportRetries < run.cfg.httpRetries) {
    s.transportRetries++;
    return Math.min(500 * 2 ** (s.transportRetries - 1), 4000);
  }
  return STOP;
}
/** Replay the journaled attempts of a job, then request until a decision, a stop or the retry limits. */
export async function attemptJob(run, job, p) {
  const s = {
    attempts: [],
    parsed: null,
    parsedSystemOne: null,
    firstDecision: null,
    status: undefined,
    errorKind: "invalid",
    transportRetries: 0,
    parseRetries: 0,
    retryNote: undefined,
  };
  const replay = journalReplay(run.journalByKey.get(job.key));
  while (!run.abort.signal.aborted) {
    const next = replay.pending()
      ? { attempt: replay.next() }
      : // biome-ignore lint/performance/noAwaitInLoops: per-job retry loop; the randomized delay between provider requests is the rate limit, and each retry depends on the previous attempt's outcome
        await issueAttempt(run, job, p, s);
    if (next.stop) return { ...s, status: next.stop, errorKind: "transport" };
    s.attempts.push(next.attempt);
    const backoff = settle(run, job, p, s, next.attempt);
    if (backoff === STOP) return s;
    if (backoff && !replay.pending()) await delay(backoff);
  }
  return { ...s, status: "interrupted", errorKind: "transport" };
}
