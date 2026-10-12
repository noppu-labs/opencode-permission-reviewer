import { open, writeFile } from "node:fs/promises";
import { assert, exists, readJSONL } from "./util.mjs";

/** A serializing JSONL writer. Each completed HTTP attempt is persisted before parsing/retrying. */
export async function writer(path) {
  const file = await open(path, "a", 0o600);
  await file.chmod(0o600);
  let pending = Promise.resolve();
  return {
    write: (value) => {
      pending = pending.then(async () => {
        await file.write(`${JSON.stringify(value)}\n`);
        await file.sync();
      });
      return pending;
    },
    close: async () => {
      await pending;
      await file.close();
    },
  };
}
async function recover(path) {
  if (!(await exists(path))) return [];
  const read = await readJSONL(path, { recoverTail: true });
  if (read.truncatedBytes) {
    await writeFile(
      `${path}.recovered-tail.txt`,
      "A final incomplete JSONL record was discarded during explicit resume. Bytes: " +
        read.truncatedBytes +
        "\n",
      { mode: 0o600 },
    );
    await writeFile(path, read.validText, { mode: 0o600 });
  }
  return read.rows;
}
export async function readPrior(paths, resume, fingerprint) {
  const rows = resume ? await recover(paths.rowsPath) : [];
  const journal = resume ? await recover(paths.attemptPath) : [];
  const previousEvents = resume ? await recover(paths.eventsPath) : [];
  const startedCalls = previousEvents.filter((e) => e.event === "http-start");
  const completed = new Set();
  for (const r of rows) {
    assert(r.runFingerprint === fingerprint, "Unexpected row fingerprint.");
    const key = `${r.modelId}/${r.caseId}/${r.repeat}`;
    assert(!completed.has(key), `Duplicate completed result: ${key}`);
    completed.add(key);
  }
  return { rows, journal, startedCalls, completed };
}
export function indexJournal(journal, fingerprint) {
  const journalByKey = new Map();
  for (const a of journal) {
    assert(a.runFingerprint === fingerprint, "Unexpected attempt fingerprint.");
    if (!journalByKey.has(a.key)) journalByKey.set(a.key, []);
    journalByKey.get(a.key).push(a);
  }
  return journalByKey;
}
/** Hand out a job's journaled attempts in order. */
export function journalReplay(journaled) {
  const saved = journaled ?? [];
  let index = 0;
  return {
    pending: () => index < saved.length,
    next: () => saved[index++].attempt,
  };
}
// A crash after sending a request but before journaling its response has
// uncertain billing. Count it and fail that request without blind retry.
export async function recoverInFlight(
  startedCalls,
  journalByKey,
  fingerprint,
  attemptWriter,
) {
  for (const e of startedCalls) {
    const saved = journalByKey.get(e.key) ?? [];
    if (!saved.some((a) => a.ordinal === e.ordinal)) {
      const recovered = {
        schemaVersion: 1,
        runFingerprint: fingerprint,
        key: e.key,
        ordinal: e.ordinal,
        at: new Date().toISOString(),
        attempt: {
          ok: false,
          status: null,
          error:
            "Response lost after an in-flight HTTP request; billing/outcome unknown. Not automatically retried.",
          uncertainInFlight: true,
          latencyMs: 0,
        },
      };
      saved.push(recovered);
      saved.sort((a, b) => a.ordinal - b.ordinal);
      journalByKey.set(e.key, saved);
      // biome-ignore lint/performance/noAwaitInLoops: the attempt journal is an fsynced crash-recovery log; each recovered attempt is durably written, in startedCalls order, before the next one is recorded
      await attemptWriter.write(recovered);
    }
  }
}
