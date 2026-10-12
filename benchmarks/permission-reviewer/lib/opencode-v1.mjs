import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostClient, messageBody, sessionAnswer } from "./opencode-v1-host.mjs";
import { safeError } from "./util.mjs";

const INSTANCE_DISPOSE_ATTEMPTS = 3;

const halted = (error, message, started) => ({
  ok: false,
  status: typeof error.status === "number" ? error.status : null,
  error: message,
  rawText: "",
  latencyMs: performance.now() - started,
  halt: true,
});
/** Delete the session and dispose the instance; returns the last disposal error, if every attempt failed. */
async function cleanUp(call, sessionID) {
  if (sessionID) {
    try {
      await call(
        "DELETE",
        `/session/${encodeURIComponent(sessionID)}`,
        undefined,
        AbortSignal.timeout(5000),
      );
    } catch {
      // The benchmark never converts cleanup failures into an approval.
    }
  }
  let disposalError;
  for (let attempt = 0; attempt < INSTANCE_DISPOSE_ATTEMPTS; attempt++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: dispose retry; each attempt runs only after the previous one failed and the loop stops at the first success, so the host never sees overlapping dispose calls
      await call(
        "POST",
        "/instance/dispose",
        undefined,
        AbortSignal.timeout(5000),
      );
      disposalError = undefined;
      break;
    } catch (error) {
      disposalError = error;
    }
  }
  return disposalError;
}
/** Send a benchmark prompt through an actual OpenCode V1 host, never through its OAuth tokens. */
export async function requestOpenCodeV1(
  model,
  prepared,
  { timeoutMs = 120000, retryNote, signal, fetchImpl = fetch } = {},
) {
  const started = performance.now();
  const directory = await mkdtemp(join(tmpdir(), "prb-opencode-v1-"));
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let sessionID;
  let outcome;
  const password = process.env[model.hostPasswordEnv];
  if (!password) {
    await rm(directory, { recursive: true });
    throw new Error(
      `Missing OpenCode host password environment variable ${model.hostPasswordEnv}`,
    );
  }
  const call = hostClient(model, directory, password, fetchImpl, requestSignal);
  try {
    const created = await call("POST", "/session", {
      title: "Synthetic permission benchmark",
    });
    sessionID = created?.id;
    if (typeof sessionID !== "string" || !sessionID.startsWith("ses_"))
      throw new Error("OpenCode returned an invalid session ID");
    const [providerID, modelID] = model.model.split("/");
    const result = await call(
      "POST",
      `/session/${encodeURIComponent(sessionID)}/message`,
      messageBody(model, prepared, retryNote, { providerID, modelID }),
    );
    outcome = sessionAnswer(
      result,
      model,
      sessionID,
      { providerID, modelID },
      started,
    );
  } catch (error) {
    outcome = halted(error, safeError(error), started);
  } finally {
    const disposalError = await cleanUp(call, sessionID);
    if (disposalError)
      outcome = halted(
        disposalError,
        `OpenCode instance cleanup failed after ${INSTANCE_DISPOSE_ATTEMPTS} attempts: ${safeError(disposalError)}`,
        started,
      );
    await rm(directory, { recursive: true });
  }
  return outcome;
}
