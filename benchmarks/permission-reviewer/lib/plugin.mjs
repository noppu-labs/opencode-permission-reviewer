import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PINNED_BLOBS } from "./pinned-blobs.mjs";
import { replayAdapter } from "./plugin-adapter.mjs";
import { sourceSnapshot } from "./source-snapshot.mjs";
import { assert } from "./util.mjs";

const CORE_MODULES = {
  policy: "src/modules/context/services/prompt/policy.ts",
  context: "src/modules/context/services/prompt/context.ts",
  config: "src/modules/config/services/config.ts",
  decision: "src/modules/decision/decision.ts",
  decisionGates: "src/modules/decision/decision-gates.ts",
  decisionSchema: "src/modules/decision/decision-schema.ts",
  escalation: "src/modules/decision/escalation.ts",
  engine: "src/modules/review/services/review-engine.ts",
  parser: "src/modules/analysis/capability/command-parser.ts",
  analyzer: "src/modules/analysis/capability/bash-analyzer.ts",
  systemOne: "src/modules/reviewer/services/review.ts",
  systemOneQuestions: "src/modules/reviewer/services/system-one-questions.ts",
};
async function loadCore(repo) {
  const names = Object.keys(CORE_MODULES);
  const modules = await Promise.all(
    names.map(
      (name) => import(pathToFileURL(resolve(repo, CORE_MODULES[name])).href),
    ),
  );
  return Object.fromEntries(names.map((name, i) => [name, modules[i]]));
}
/** Import only the reviewed pure/core layers. Never import index.ts, host backends or evidence providers with filesystem/SSH access. */
export async function openPlugin(
  repo,
  { allowDrift = false, allowNode = false } = {},
) {
  assert(repo, "Provide --repo pointing to your checked-out plugin.");
  if (!process.versions.bun && !allowNode)
    throw new Error(
      "Use Bun for real plugin imports: bun cli.mjs run ... . Node is supported for offline tests/baselines.",
    );
  const snapshot = await sourceSnapshot(repo, PINNED_BLOBS);
  assert(
    snapshot.match || allowDrift,
    "Inspected plugin files differ from the pinned snapshot. Use the pinned checkout or explicitly pass --allow-drift; differences are recorded.",
  );
  const core = await loadCore(repo);
  assert(
    typeof core.context.buildEvidenceResult === "function" &&
      typeof core.engine.evaluateReview === "function",
    "Unsupported core exports.",
  );
  return replayAdapter(snapshot, core);
}
