import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenCode } from "@opencode/client";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { OpenCodeClientLike } from "../../src/adapters/opencode/types.ts";
import { hostCompatibleFetch } from "../../src/adapters/opencode/v2/connection.ts";
import type { PermissionRequest } from "../../src/kernel/permission-request.ts";
import type { ReviewEnvelope } from "../../src/modules/context/models/review-envelope.ts";

const [generation, url, directory, sessionID, command, sourceRoot] =
  process.argv.slice(2);
if (!generation || !url || !directory || !sessionID || !command)
  throw new Error("Missing evidence fixture settings");
const root: string = sourceRoot ?? new URL("../..", import.meta.url).pathname;
// The modules load from a source root chosen at runtime, so each call names the shape it expects.
const load = <Module>(path: string): Promise<Module> =>
  import(pathToFileURL(join(root, "src", path)).href);
const [
  { assembleEvidence, defaultEvidenceProviders },
  { buildEvidenceResult },
  { resolveConfig },
]: [
  typeof import("../../src/modules/context/services/evidence-assembler.ts"),
  typeof import("../../src/modules/context/services/prompt/context.ts"),
  typeof import("../../src/modules/config/services/config.ts"),
] = await Promise.all([
  load<
    typeof import("../../src/modules/context/services/evidence-assembler.ts")
  >("modules/context/services/evidence-assembler.ts"),
  load<typeof import("../../src/modules/context/services/prompt/context.ts")>(
    "modules/context/services/prompt/context.ts",
  ),
  load<typeof import("../../src/modules/config/services/config.ts")>(
    "modules/config/services/config.ts",
  ),
]);
const controller = new AbortController();
const password: string | undefined = process.env.OPENCODE_PASSWORD;
const headers = password
  ? {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    }
  : {};
const reader =
  generation === "v1"
    ? (
        await load<
          typeof import("../../src/adapters/opencode/v1/context-reader.ts")
        >("adapters/opencode/v1/context-reader.ts")
      ).createV1ContextReader(
        createOpencodeClient({
          baseUrl: url,
          headers,
        }) as unknown as OpenCodeClientLike,
        controller.signal,
      )
    : (
        await load<
          typeof import("../../src/adapters/opencode/v2/context-reader.ts")
        >("adapters/opencode/v2/context-reader.ts")
      ).createV2ContextReader(
        OpenCode.make({ baseUrl: url, headers, fetch: hostCompatibleFetch() }),
        controller.signal,
      );
const config = resolveConfig({ model: "fixture/reviewer", timeoutMs: 30000 });
const request: PermissionRequest = {
  id: "fixture-evidence",
  sessionID,
  permission: "bash",
  patterns: [command],
  metadata: { command },
  always: [],
};
const envelope: ReviewEnvelope = await assembleEvidence(
  request,
  defaultEvidenceProviders(),
  {
    reader,
    directory,
    worktree: directory,
    config,
  },
);
const result = buildEvidenceResult(envelope, config);
console.log(
  JSON.stringify({
    text: result.text,
    characters: result.text.length,
    actionEvidenceComplete: result.actionEvidenceComplete,
    intent: envelope.intent?.directUserIntent,
    timings: envelope.timings,
    budget:
      config.maxContextChars +
      config.maxPartChars * 2 +
      config.maxEnrichmentChars +
      config.maxIntentChars,
  }),
);
