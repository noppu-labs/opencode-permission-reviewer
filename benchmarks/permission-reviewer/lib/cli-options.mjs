import { assert } from "./util.mjs";

const BOOLS = new Set([
  "resume",
  "allow-drift",
  "all",
  "no-prompts",
  "oracle",
  "allow-profile-diff",
]);
const VALUES = new Set([
  "data",
  "repo",
  "models",
  "out",
  "run",
  "left",
  "right",
  "left-model",
  "right-model",
  "layer",
  "split",
  "category",
  "id",
  "limit",
  "repeats",
  "concurrency",
  "seed",
  "max-calls",
  "min-request-delay-ms",
  "max-request-delay-ms",
  "timeout-ms",
  "http-retries",
  "format-retries",
  "bootstrap",
  "sample",
  "track",
  "difficult-from",
]);
/** `--name value` and boolean `--flag` options, each known and given once. */
export function parseOptions(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    assert(key.startsWith("--"), `Unexpected argument ${key}`);
    const name = key.slice(2);
    assert(BOOLS.has(name) || VALUES.has(name), `Unknown option ${key}`);
    assert(out[name] === undefined, `Duplicate option ${key}`);
    if (BOOLS.has(name)) out[name] = true;
    else {
      assert(
        argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"),
        `Missing value for ${key}`,
      );
      out[name] = argv[++i];
    }
  }
  return out;
}
