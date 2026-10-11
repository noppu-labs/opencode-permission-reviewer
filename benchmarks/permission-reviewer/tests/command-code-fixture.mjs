import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stand-in Command Code CLI. PRB_TEST_CC_MODE picks the behaviour; the default
// answers with what it received (query, arguments, working directory, environment).
const SCRIPT = `#!/usr/bin/env node
const mode = process.env.PRB_TEST_CC_MODE ?? "echo";
const out = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const linger = () => setInterval(() => {}, 1000);
if (mode === "ignore-term") process.on("SIGTERM", () => {});
const modes = {
  hang: linger,
  "ignore-term": linger,
  flood: () => { const mb = "x".repeat(1024 * 1024); for (let i = 0; i < 40; i++) process.stdout.write(mb); linger(); },
  exit3: () => process.exit(3),
};
let query = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { query += chunk; });
process.stdin.on("end", () => {
  if (modes[mode]) return modes[mode]();
  const args = process.argv.slice(2);
  const model = mode === "other-model" ? "other/model" : args[args.indexOf("--model") + 1];
  process.stdout.write("diagnostic line\\n");
  out({ type: "event" });
  process.stdout.write('{"type":"event","event":{"type":"model_req');
  process.stdout.write('uest_start","model":' + JSON.stringify(model) + "}}\\n");
  if (mode === "tool" || mode === "other-model") out({ type: "event", event: { type: "tool_running" } });
  const finalText = {
    empty: "",
    number: 5,
  }[mode] ?? JSON.stringify({
    query,
    args,
    cwd: process.cwd(),
    noColor: process.env.NO_COLOR,
    keys: [process.env.COMMAND_CODE_API_KEY, process.env.CMD_API_KEY],
  });
  const usage = { "no-usage": undefined, "partial-usage": {} }[mode] ?? { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 };
  out({
    type: "result",
    subtype: mode === "incomplete" ? "error" : "success",
    stopReason: mode === "max-turns" ? "max_turns" : "end_turn",
    finalText,
    ...(mode === "no-usage" ? {} : { usage }),
  });
});
`;

/** Write the stand-in CLI to a fresh directory; returns its path and a cleanup. */
export async function fakeCommandCode() {
  const directory = await mkdtemp(join(tmpdir(), "prb-command-code-fixture-"));
  const binary = join(directory, "commandcode");
  await writeFile(binary, SCRIPT);
  await chmod(binary, 0o700);
  return {
    binary,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}
