import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cliArgs,
  commandCodeAnswer,
  frameCollector,
} from "./command-code-protocol.mjs";

/** Run one synthetic request in a fresh official Command Code headless process. */
export async function requestCommandCodeCli(
  model,
  prepared,
  { timeoutMs = 120000, retryNote, signal } = {},
) {
  const started = performance.now();
  const binary = process.env[model.commandCodeBinEnv];
  if (!binary)
    throw new Error(
      `Missing Command Code binary environment variable ${model.commandCodeBinEnv}`,
    );
  const directory = await mkdtemp(join(tmpdir(), "prb-command-code-"));
  const query =
    `<reviewer_system>\n${prepared.system}\n</reviewer_system>\n\n` +
    `<permission_request>\n${prepared.user}${retryNote ? `\n\n${retryNote}` : ""}\n</permission_request>`;
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.COMMAND_CODE_API_KEY;
  delete env.CMD_API_KEY;
  const run = { timedOut: false, aborted: false };
  let child;
  let timer;
  let killTimer;
  const terminate = () => {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
    killTimer.unref();
  };
  const onAbort = () => {
    run.aborted = true;
    terminate();
  };
  try {
    if (signal?.aborted) {
      run.aborted = true;
      throw new Error("Benchmark request was interrupted");
    }
    child = spawn(binary, cliArgs(model), {
      cwd: directory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      run.timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
    const frames = frameCollector(terminate);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", frames.onData);
    child.stderr.resume();
    child.stdin.on("error", () => {
      // An early CLI exit is reported through its exit code, not a pipe error.
    });
    child.stdin.end(query);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return commandCodeAnswer(
      { ...run, ...frames.state, exitCode },
      model,
      started,
    );
  } catch (error) {
    return {
      ok: false,
      status: null,
      error:
        error instanceof Error ? error.message : "Command Code request failed.",
      rawText: "",
      latencyMs: performance.now() - started,
      halt: true,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener("abort", onAbort);
    await rm(directory, { recursive: true, force: true });
  }
}
