import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setGlobalConfigPathForTests } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { resolveActorContext } from "../../src/context/actor-resolver.ts";
import type { ClientResponse } from "../../src/opencode/types.ts";
import type { MessageWithParts } from "../../src/types.ts";
import { decision, defined, MockClient, request, runtime } from "../helpers.ts";
import {
  expectModelAllowBlocked,
  loadTrustedRules,
  tempDir,
} from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

describe("trust hardening — reviewer session isolation", () => {
  test("the reviewer session runs in an isolated directory with a wildcard tool deny", async () => {
    const client = new MockClient();
    const harness = runtime(client);
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("allow");

    expect(client.creates).toHaveLength(1);
    const create = client.creates[0] as {
      body?: { parentID?: string };
      query?: { directory?: string };
    };
    expect(create.query?.directory).toContain("tmp-reviewer-isolated");
    expect(create.query?.directory).not.toBe("/workspace/project");
    expect(create.body?.parentID).toBeUndefined();

    // Every prompt carries the same isolated directory and a wildcard deny
    // covering named tools AND anything else (MCP included).
    expect(client.prompts.length).toBeGreaterThan(0);
    for (const prompt of client.prompts as Array<{
      query?: { directory?: string };
      body?: { tools?: Record<string, boolean> };
    }>) {
      expect(prompt.query?.directory).toBe(create.query?.directory);
      expect(prompt.body?.tools?.["*"]).toBe(false);
      for (const id of ["bash", "read", "write", "webfetch", "task"]) {
        expect(prompt.body?.tools?.[id]).toBe(false);
      }
    }
    const del = client.deletes[0] as { query?: { directory?: string } };
    expect(del.query?.directory).toBe(create.query?.directory);
  });

  test("when the isolated directory is refused, no project reviewer or approval is created", async () => {
    const client = new MockClient();
    const isolated = join(import.meta.dir, "..", ".tmp-reviewer-isolated");
    const originalCreate = client.session.create.bind(client);
    client.session.create = async (
      options: unknown,
    ): Promise<ClientResponse<Record<string, unknown>>> => {
      const query = (options as { query?: { directory?: string } }).query;
      if (query?.directory === isolated) {
        client.creates.push(options);
        return { error: { message: "unknown directory" } };
      }
      return originalCreate(options);
    };
    const harness = runtime(client);
    const result = await harness.runtime.process(request());
    expect(result.kind).toBe("escalate");
    expect(client.creates).toHaveLength(1);
    expect(client.prompts).toHaveLength(0);
    expect(client.replies).toHaveLength(0);
  });
});

describe("review regression boundaries", () => {
  test("directory creation failure never prompts or approves", async () => {
    const dir = tempDir("reviewer-isolation-failure-");
    const file = join(dir, "file");
    writeFileSync(file, "not a directory");
    try {
      const client = new MockClient();
      const harness = runtime(client, {}, undefined, {
        reviewerDirectoryBase: join(file, "child"),
      });
      expect((await harness.runtime.process(request())).kind).toBe("escalate");
      expect(client.creates).toHaveLength(0);
      expect(client.prompts).toHaveLength(0);
      expect(client.replies).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const layer of ["global", "inline"] as const) {
    for (const policyRules of [
      { effect: "deny" },
      null,
      [{ effect: "deny", when: { typo: true } }],
    ]) {
      test(`invalid trusted ${layer} rules block model allow: ${JSON.stringify(policyRules)}`, async () => {
        const dir = tempDir("reviewer-rules-");
        try {
          const config = loadTrustedRules(dir, layer, policyRules);
          expect(config.configDegraded?.length).toBeGreaterThan(0);
          await expectModelAllowBlocked(config);
        } finally {
          setGlobalConfigPathForTests(undefined);
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }

  for (const kind of [
    "bounded",
    "missing-parent",
    "missing-metadata",
  ] as const) {
    test(`${kind} never presents child messages as human authorization`, async () => {
      const client = new MockClient();
      client.session.get = async (): Promise<ClientResponse<unknown>> =>
        kind === "missing-metadata"
          ? { error: "unavailable" }
          : { data: { id: "ses_main", parentID: "ses_missing" } };
      const harness = runtime(client, {
        maxParentSessions: kind === "bounded" ? 0 : 4,
      });
      await harness.runtime.process(request());
      const prompt = client.prompts[0] as {
        body: { parts: Array<{ text: string }> };
      };
      const text = defined(prompt.body.parts[0], "prompt part").text;
      expect(text).not.toContain('"actor": "user"');
      expect(text).not.toContain("USER_INTENT_HISTORY\nuser:");
      const res = await resolveActorContext(
        request(),
        client.messageData as MessageWithParts[],
        client,
        "/repo",
        { ...DEFAULT_CONFIG, maxParentSessions: 0 },
      );
      expect(res.lineage.origin).toBe(
        kind === "missing-metadata" ? "unknown" : "delegated",
      );
      expect(res.intent.directUserIntent).toHaveLength(0);
      expect(res.intent.localSessionIntent[0]?.actor).toBe(
        kind === "missing-metadata" ? "unknown" : "assistant",
      );
    });
  }

  test("large preceding intent cannot displace the pending action from the final provider prompt", async () => {
    const client = new MockClient();
    client.session.get = async (): Promise<ClientResponse<unknown>> => ({
      data: { id: "ses_main" },
    });
    client.messageData = [1, 2, 3].map((id) => ({
      info: { id: `msg_${id}`, role: "user" },
      parts: [{ type: "text", text: "a".repeat(7900) }],
    }));
    const harness = runtime(client, {
      maxPartChars: 8000,
      maxContextChars: 4000,
      maxEnrichmentChars: 1000,
      maxIntentChars: 1000,
    });
    expect((await harness.runtime.process(request())).kind).toBe("allow");
    const prompt = client.prompts[0] as {
      body: { parts: Array<{ text: string }> };
    };
    const part = defined(prompt.body.parts[0], "prompt part");
    expect(part.text).toContain("PENDING_PERMISSION");
    expect(part.text).toContain('"command": "printf safe"');
  });

  test("text mode keeps every tool disabled", async () => {
    const client = new MockClient();
    client.nextText = JSON.stringify(decision("allow"));
    await runtime(client, { outputFormat: "text" }).runtime.process(request());
    const prompt = client.prompts[0] as {
      body: { tools: Record<string, boolean> };
    };
    expect(
      Object.values(prompt.body.tools).every((value) => value === false),
    ).toBe(true);
  });
});
