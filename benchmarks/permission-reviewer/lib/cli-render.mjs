import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { modelInput } from "./dataset.mjs";
import { assert, atomicJSON, exists, privateDir, toJsonl } from "./util.mjs";

/** Write every case x model request the run would send, without sending any. */
export async function render(a, { adapter, models, cases, data }) {
  assert(
    !(await exists(resolve(a.out, "requests.jsonl"))),
    "Render file already exists.",
  );
  await privateDir(resolve(a.out));
  const requests = [];
  for (const c of cases)
    for (const model of models) {
      // biome-ignore lint/performance/noAwaitInLoops: adapter.prepare is in-process work on fixture envelopes (collect returns the fixture, evidence is built synchronously, no file, git or network I/O), so running cases x models concurrently would overlap nothing; the loop builds requests.jsonl lines in case-then-model order
      const p = await adapter.prepare(modelInput(c), model);
      requests.push({
        caseId: c.id,
        modelId: model.id,
        reachable: p.reachable,
        promptHash: p.promptHash,
        evidenceHash: p.evidenceHash,
        actionEvidenceComplete: p.actionEvidenceComplete,
        ...(model.transport === "system-one"
          ? { systemOne: p.systemOne }
          : { system: p.system, user: p.user, schema: p.schema }),
      });
    }
  await writeFile(resolve(a.out, "requests.jsonl"), toJsonl(requests), {
    mode: 0o600,
  });
  await atomicJSON(resolve(a.out, "render-manifest.json"), {
    cases: cases.length,
    models: models.length,
    source: adapter.snapshot,
    datasetHash: data.hash,
    promptVersion: adapter.promptVersion,
  });
  console.log(
    `${requests.length} rendered requests; ZERO network calls and ZERO fixture executions.`,
  );
}
