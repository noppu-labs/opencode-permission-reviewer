import { describe, expect, test } from "bun:test";
import { isSystemOneReviewerModel, resolveConfig } from "../../src/config.ts";
import {
  createSystemOneInvoker,
  SystemOneReviewerBackend,
} from "../../src/system-one/backend.ts";
import {
  parseSystemOneReview,
  SYSTEM_ONE_QUESTIONS,
} from "../../src/system-one/review.ts";
import {
  response,
  reviewOnce,
  withSyntheticCommandCodeKey,
} from "./system-one-fixtures.ts";

describe("System One reviewer", () => {
  test("selects only known Jev providers and model IDs", () => {
    expect(isSystemOneReviewerModel("opencode/jev-1.13-free")).toBe(true);
    expect(isSystemOneReviewerModel("typesafe-ai/jev-latest")).toBe(true);
    expect(isSystemOneReviewerModel("commandcode/typesafe/jev")).toBe(true);
    expect(isSystemOneReviewerModel("commandcode/jev-1.13")).toBe(false);
    expect(isSystemOneReviewerModel("commandcode/typesafe/other")).toBe(false);
    expect(isSystemOneReviewerModel("other/jev-1.13")).toBe(false);
    expect(isSystemOneReviewerModel("opencode/not-jev")).toBe(false);
  });

  test("routes Zen, TypeSafe, and Command Code through their System One endpoints", async () => {
    const providers = [
      {
        model: "opencode/jev-1.13",
        returnedModel: "jev-1.13",
        keyName: "OPENCODE_API_KEY",
        url: "https://opencode.ai/zen/v1/systemone",
      },
      {
        model: "typesafe-ai/jev-1.13.0",
        returnedModel: "jev-1.13.0",
        keyName: "TYPESAFE_API_KEY",
        url: "https://api.typesafe.ai/v1/systemone",
      },
      {
        model: "commandcode/typesafe/jev",
        returnedModel: "typesafe/jev",
        keyName: "CMD_API_KEY",
        url: "https://api.commandcode.ai/provider/v1/systemone",
      },
    ] as const;
    const previousBaseURL = process.env.TYPESAFE_BASE_URL;
    delete process.env.TYPESAFE_BASE_URL;
    try {
      for (const provider of providers) {
        const previousKey = process.env[provider.keyName];
        const apiKey = `synthetic-${provider.keyName.toLowerCase()}`;
        process.env[provider.keyName] = apiKey;
        try {
          const config = resolveConfig({ model: provider.model });
          const state = {
            trustedPolicy: { reviewer: "policy", tenant: "tenant" },
            untrustedEvidence: "evidence",
          };
          const calls: Array<{ url: string; init: RequestInit }> = [];
          const invoke = createSystemOneInvoker(config, async (url, init) => {
            calls.push({ url: String(url), init: init ?? {} });
            return Response.json({
              ...response(),
              model: provider.returnedModel,
            });
          });
          // biome-ignore lint/performance/noAwaitInLoops: each case sets and restores process.env provider keys around its invoker, so cases must not overlap
          const raw = await invoke(state, new AbortController().signal);
          expect(calls).toHaveLength(1);
          expect(calls[0]?.url).toBe(provider.url);
          expect(calls[0]?.init.method).toBe("POST");
          expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
            `Bearer ${apiKey}`,
          );
          expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
            model: provider.model.slice(provider.model.indexOf("/") + 1),
            state,
            questions: SYSTEM_ONE_QUESTIONS,
          });
          expect(parseSystemOneReview(raw, config)?.decision.outcome).toBe(
            "allow",
          );
        } finally {
          if (previousKey === undefined) delete process.env[provider.keyName];
          else process.env[provider.keyName] = previousKey;
        }
      }
    } finally {
      if (previousBaseURL === undefined) delete process.env.TYPESAFE_BASE_URL;
      else process.env.TYPESAFE_BASE_URL = previousBaseURL;
    }
  });

  test("rejects an unexpected returned model from Command Code", () => {
    const config = resolveConfig({ model: "commandcode/typesafe/jev" });
    expect(
      parseSystemOneReview({ ...response(), model: "jev-1.13" }, config),
    ).toBeUndefined();
  });

  test("does not borrow a TypeSafe key for a Command Code request", () => {
    const commandKey = process.env.CMD_API_KEY;
    const typesafeKey = process.env.TYPESAFE_API_KEY;
    delete process.env.CMD_API_KEY;
    process.env.TYPESAFE_API_KEY = "synthetic-typesafe-key";
    try {
      expect(() =>
        createSystemOneInvoker(
          resolveConfig({ model: "commandcode/typesafe/jev" }),
        ),
      ).toThrow(/Missing CMD_API_KEY/);
    } finally {
      if (commandKey === undefined) delete process.env.CMD_API_KEY;
      else process.env.CMD_API_KEY = commandKey;
      if (typesafeKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = typesafeKey;
    }
  });

  test("recovers from two temporary 503 responses with one valid Jev decision", async () => {
    await withSyntheticCommandCodeKey(async () => {
      const config = resolveConfig({ model: "commandcode/typesafe/jev" });
      const state = {
        trustedPolicy: { reviewer: "policy", tenant: "tenant" },
        untrustedEvidence: "synthetic evidence",
      };
      let calls = 0;
      const invoke = createSystemOneInvoker(config, async () => {
        calls++;
        return calls < 3
          ? Response.json(
              { error: { message: "Upstream temporarily unavailable" } },
              { status: 503 },
            )
          : Response.json({ ...response(), model: "typesafe/jev" });
      });
      const raw = await invoke(state, new AbortController().signal);
      expect(calls).toBe(3);
      expect(parseSystemOneReview(raw, config)?.decision.outcome).toBe("allow");
    });
  }, 10_000);

  test("keeps an exhausted 503 fail-closed and does not retry authentication failures", async () => {
    await withSyntheticCommandCodeKey(async () => {
      const config = resolveConfig({
        model: "commandcode/typesafe/jev",
        escalationMode: "deny",
      });
      let calls = 0;
      const failed = createSystemOneInvoker(config, async () => {
        calls++;
        return Response.json(
          { error: { message: "Upstream temporarily unavailable" } },
          { status: 503 },
        );
      });
      const result = await reviewOnce(
        new SystemOneReviewerBackend(config, undefined, undefined, failed),
      );
      expect(calls).toBe(3);
      expect(result.kind).toBe("deny");
      expect(result.decisionSource).toBe("failure-safe");

      calls = 0;
      const unauthorized = createSystemOneInvoker(config, async () => {
        calls++;
        return Response.json(
          { error: { message: "Invalid API key" } },
          { status: 401 },
        );
      });
      await expect(
        unauthorized(
          {
            trustedPolicy: { reviewer: "policy", tenant: "tenant" },
            untrustedEvidence: "",
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(calls).toBe(1);
    });
  }, 10_000);

  test("cancellation during a 503 backoff prevents another request", async () => {
    await withSyntheticCommandCodeKey(async () => {
      const config = resolveConfig({ model: "commandcode/typesafe/jev" });
      let calls = 0;
      const invoke = createSystemOneInvoker(config, async () => {
        calls++;
        return Response.json(
          { error: { message: "Unavailable" } },
          { status: 503 },
        );
      });
      const controller = new AbortController();
      const pending = invoke(
        {
          trustedPolicy: { reviewer: "policy", tenant: "tenant" },
          untrustedEvidence: "",
        },
        controller.signal,
      );
      setTimeout(() => controller.abort(new Error("Review cancelled")), 20);
      await expect(pending).rejects.toThrow(/aborted/);
      expect(calls).toBe(1);
    });
  });
});
