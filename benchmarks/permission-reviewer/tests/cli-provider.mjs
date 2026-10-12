import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { decision } from "./helpers.mjs";

/** A local OpenAI-style provider that answers every request with a deny decision. */
export async function withProvider(check) {
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      calls++;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          model: "synthetic-provider",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(decision("deny")) },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await check({
      endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
      calls: () => calls,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Provider retries off, so each decision costs exactly one request. */
export const noRetries = ["--http-retries", "0", "--format-retries", "0"];
/** A models file in `dir` naming one text model at `endpoint`, as a bare array or wrapped in { models }. */
export async function modelsFile(dir, endpoint, wrap) {
  const path = join(dir, wrap ? "wrapped.json" : "models.json");
  const models = [{ id: "p", model: "p", format: "text", endpoint }];
  await writeFile(path, JSON.stringify(wrap ? { models } : models));
  return path;
}
