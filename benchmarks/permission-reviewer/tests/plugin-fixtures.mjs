import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDataset, modelInput } from "../lib/dataset.mjs";
import { openPlugin } from "../lib/plugin.mjs";

/** The plugin checkout this kit lives in, opened in-process (Node strips the TypeScript types). */
export const repo = fileURLToPath(new URL("../../../", import.meta.url));
export const adapter = await openPlugin(repo, { allowNode: true });
export const core = (path) => import(pathToFileURL(resolve(repo, path)).href);
const { cases } = await loadDataset(
  fileURLToPath(new URL("../data/cases.jsonl", import.meta.url)),
);
/** A fresh model input for the first bash case, safe to mutate. */
export const bashInput = () =>
  modelInput(cases.find((c) => c.input.request.permission === "bash"));
export const message = (id, role, text, part = {}, created) => ({
  info: {
    id,
    role,
    ...(created === undefined ? {} : { time: { created } }),
  },
  parts: [{ type: "text", text, ...part }],
});
export const textModel = { id: "text", model: "m", format: "text" };
const engine = await core("src/modules/review/services/review-engine.ts");
/** The core's effective outcome when the reviewer returns `result` for a prepared request. */
export const replay = (prepared, result) =>
  engine.evaluateReview(prepared.envelope.request, prepared.config, {
    collect: async () => prepared.envelope,
    review: async () => structuredClone(result),
    active: () => true,
    auxiliarySession: () => false,
    observe: () => {},
  });
