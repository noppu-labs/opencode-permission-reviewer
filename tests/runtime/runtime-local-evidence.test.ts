import { beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { SK_CREDENTIAL } from "../fixtures/synthetic-secrets.ts";
import { decision, MockClient, request, runtime } from "../helpers.ts";
import { phases, replyBody } from "./runtime-fixtures.ts";

const execFileAsync = promisify(execFile);

function commandRequest(command: string): ReturnType<typeof request> {
  return request({ patterns: [command], metadata: { command } });
}

function inDirectory(
  client: MockClient,
  directory: string,
): ReturnType<typeof runtime> {
  return runtime(client, {}, undefined, { directory, worktree: directory });
}

async function withTempDir(
  prefix: string,
  body: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(`/tmp/opencode/approval-reviewer-${prefix}`);
  try {
    await body(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

// /tmp/opencode is one of the plugin's approved enrichment roots. It exists on
// machines that run OpenCode, but not on a fresh CI runner or a clean clone.
beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
});

describe("runtime decisions", () => {
  test("rejects missing remote stdin automatically without invoking Luna", async () => {
    const client = new MockClient();
    const missing = `/tmp/opencode/approval-reviewer-missing-${crypto.randomUUID()}.py`;
    const command = `cat ${missing} | ssh ubuntu@203.0.113.8 'docker exec -i app python -'`;
    const harness = runtime(client);
    const result = await harness.runtime.process(commandRequest(command));
    expect(result.kind).toBe("deny");
    expect(result.reason).toContain("does not exist after a second check");
    expect(client.creates).toHaveLength(0);
    expect(client.prompts).toHaveLength(0);
    expect(replyBody(client.replies[0]).reply).toBe("reject");
    expect(phases(client)).toEqual(["reviewing", "denied"]);
  });

  test("leaves sensitive but existing remote stdin decisions to Luna", async () => {
    await withTempDir("sensitive-", async (directory) => {
      const script = `${directory}/script.py`;
      await writeFile(script, `api_key = "${SK_CREDENTIAL}"\n`);
      const client = new MockClient();
      client.nextStructured = decision("deny", {
        rationale: "Luna rejected the credential-bearing script.",
      });
      const command = `cat ${script} | ssh ubuntu@203.0.113.8 'python -'`;
      const result = await runtime(client).runtime.process(
        commandRequest(command),
      );
      expect(result.kind).toBe("deny");
      expect(client.creates).toHaveLength(1);
      expect(client.prompts).toHaveLength(1);
      expect(result.reason).toContain("Luna rejected");
    });
  });

  test("includes bounded local script semantics in Luna's prompt without deciding locally", async () => {
    await withTempDir("runtime-script-", async (directory) => {
      const script = join(directory, "consolidate.py");
      await writeFile(
        script,
        'from pathlib import Path\nPath("guide.md").write_text("updated")\n',
      );
      const client = new MockClient();
      client.nextStructured = decision("allow", {
        rationale: "The requested local edit is bounded.",
      });
      const command = `source /opt/conda.sh && conda activate app && python3 ${script}`;
      const harness = inDirectory(client, directory);
      const result = await harness.runtime.process(commandRequest(command));
      expect(result.kind).toBe("allow");
      const prompt = JSON.stringify(client.prompts[0]);
      expect(prompt).toContain("LOCAL_SCRIPT_ANALYSIS");
      expect(prompt).toContain("guide.md");
      expect(prompt).toContain("fileMutationHint");
      expect(client.creates).toHaveLength(1);
    });
  });

  test.each([
    {
      runner: "bun",
      source: 'const key = await Bun.file(".env").text()\n',
      command: (_directory: string, script: string): string =>
        `bun run ${script} --dry-run`,
      expected: [
        "LOCAL_SCRIPT_ANALYSIS",
        "local_script",
        "runner.ts",
        ".env",
        "environmentEnumerationHint",
      ],
    },
    {
      runner: "deno",
      source: 'const key = await Deno.readTextFile(".env")\n',
      command: (directory: string, script: string): string =>
        `deno run --allow-read=${directory} ${script}`,
      expected: ["LOCAL_SCRIPT_ANALYSIS", "local_script", "runner.ts", ".env"],
    },
  ])(
    "includes $runner run target semantics in Luna's prompt",
    async ({ runner, source, command, expected }) => {
      await withTempDir(`runtime-${runner}-run-`, async (directory) => {
        const script = join(directory, "runner.ts");
        await writeFile(script, source);
        const client = new MockClient();
        client.nextStructured = decision("allow", {
          rationale: "The run target reads one bounded file.",
        });
        const harness = inDirectory(client, directory);
        const result = await harness.runtime.process(
          commandRequest(command(directory, script)),
        );
        expect(result.kind).toBe("allow");
        const evidence = JSON.stringify(
          (client.prompts[0] as { body?: { parts?: Array<{ text?: string }> } })
            .body?.parts?.[0]?.text ?? "",
        );
        for (const text of expected) expect(evidence).toContain(text);
      });
    },
  );

  test("includes branch and preexisting staging in Luna's prompt for compound Git commits", async () => {
    await withTempDir("runtime-git-", async (directory) => {
      const git = (...args: string[]): Promise<unknown> =>
        execFileAsync("git", args, { cwd: directory });
      await git("init", "-b", "staging");
      await git("config", "user.email", "reviewer@example.invalid");
      await git("config", "user.name", "Reviewer Test");
      await writeFile(join(directory, "target.py"), "before = 1\n");
      await writeFile(join(directory, "unrelated.py"), "before = 1\n");
      await git("add", "target.py", "unrelated.py");
      await git("commit", "-m", "fixture");
      await writeFile(join(directory, "target.py"), "before = 2\n");
      await writeFile(join(directory, "unrelated.py"), "before = 3\n");
      await git("add", "unrelated.py");

      const client = new MockClient();
      client.nextStructured = decision("deny", {
        rationale: "An unrelated file is already staged.",
      });
      const command = 'git add target.py && git commit -m "target only"';
      const harness = inDirectory(client, directory);
      const result = await harness.runtime.process(commandRequest(command));
      expect(result.kind).toBe("deny");
      const prompt = JSON.stringify(client.prompts[0]);
      expect(prompt).toContain("GIT_STATE_ANALYSIS");
      expect(prompt).toContain('\\"branch\\": \\"staging\\"');
      expect(prompt).toContain("target.py");
      expect(prompt).toContain("unrelated.py");
      expect(client.creates).toHaveLength(1);
    });
  });
});
